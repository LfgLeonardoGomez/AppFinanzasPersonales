"""
C-31 — password recovery, end to end.

Four things need proving, and only one of them is the happy path:

1. The public request endpoint does not reveal who has an account. Matching the
   text is the easy half; the hard half is that the miss branch must do
   comparable work, or the clock answers the question the body refused to.
2. A reset actually closes things: every open session, and every other pending
   reset token. Otherwise someone resetting because they were compromised has
   achieved nothing.
3. A bad password does not burn the token — the user retypes, they do not go
   back to their inbox.
4. No test ever contacts a real mail service.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from app.core import email as email_module
from app.core.security import hash_token_reset
from tests.conftest import make_anon_client, make_user_client, unique_client_ip


class EmailSpy:
    """Collects what would have been sent. Never touches the network."""

    def __init__(self) -> None:
        self.enviados: list[dict[str, str]] = []

    def enviar(self, destinatario: str, asunto: str, cuerpo: str) -> None:
        self.enviados.append(
            {"destinatario": destinatario, "asunto": asunto, "cuerpo": cuerpo}
        )

    def para(self, destinatario: str) -> list[dict[str, str]]:
        return [m for m in self.enviados if m["destinatario"] == destinatario]


@pytest.fixture
def correo(monkeypatch) -> EmailSpy:
    """Replace the sender for the duration of a test (regla dura #9)."""
    espia = EmailSpy()
    monkeypatch.setattr(email_module, "get_email_sender", lambda: espia)
    # usuario_service imported the symbol directly, so it needs patching too.
    from app.services import usuario_service

    monkeypatch.setattr(usuario_service, "get_email_sender", lambda: espia)
    return espia


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def app_with_db(engine, env_vars):
    from app.core.deps import reset_rate_limit_store
    from app.main import app
    from app.routers.auth import get_db as get_db_auth
    from app.routers.proveedores import get_db as get_db_proveedores
    from app.routers.usuarios import get_db as get_db_usuarios

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db_auth] = override_get_db
    app.dependency_overrides[get_db_usuarios] = override_get_db
    app.dependency_overrides[get_db_proveedores] = override_get_db

    yield app

    app.dependency_overrides.clear()


def _pedir_reset(app, email: str):
    cliente = make_anon_client(app)
    return cliente.post(
        "/api/auth/recuperar",
        json={"email": email},
        headers={"X-Forwarded-For": unique_client_ip()},
    )


def _token_del_correo(mensaje: dict) -> str:
    """Pull the raw token out of the link — it exists nowhere else."""
    cuerpo = mensaje["cuerpo"]
    marcador = "?token="
    inicio = cuerpo.index(marcador) + len(marcador)
    fin = inicio
    while fin < len(cuerpo) and cuerpo[fin] not in "\n \t":
        fin += 1
    return cuerpo[inicio:fin]


class TestNoRevelaQuienTieneCuenta:
    """El riesgo central: que el endpoint sirva para enumerar cuentas."""

    def test_cuenta_existente_e_inexistente_responden_igual(self, app_with_db, correo):
        usuario = make_user_client(app_with_db, prefix="rec1")

        con_cuenta = _pedir_reset(app_with_db, usuario.email)
        sin_cuenta = _pedir_reset(app_with_db, "nadie_de_por_aca@test.com")

        assert con_cuenta.status_code == sin_cuenta.status_code
        assert con_cuenta.json() == sin_cuenta.json()

    def test_sin_cuenta_no_persiste_token_ni_envia_correo(self, app_with_db, correo, engine):
        with engine.connect() as conn:
            antes = conn.execute(text("SELECT count(*) FROM token_reset")).scalar()

        _pedir_reset(app_with_db, "fantasma_total@test.com")

        with engine.connect() as conn:
            despues = conn.execute(text("SELECT count(*) FROM token_reset")).scalar()

        assert despues == antes
        assert correo.enviados == []

    def test_la_rama_sin_cuenta_igual_hace_el_trabajo(self, app_with_db, correo, monkeypatch):
        """D2: si la rama que falla no generara token, el reloj delataría cuál fue.

        No se miden milisegundos —sería inestable en CI— sino que el trabajo
        ocurre: el generador se invoca en ambos caminos.
        """
        from app.services import usuario_service

        llamadas = {"n": 0}
        original = usuario_service.generar_token_reset

        def contando():
            llamadas["n"] += 1
            return original()

        monkeypatch.setattr(usuario_service, "generar_token_reset", contando)

        _pedir_reset(app_with_db, "no_existe_para_nada@test.com")
        assert llamadas["n"] == 1, (
            "la rama sin cuenta no generó token: el tiempo de respuesta delata "
            "si el email existe"
        )

    def test_usuario_desactivado_no_recibe_enlace(self, app_with_db, correo, engine):
        usuario = make_user_client(app_with_db, prefix="rec2")
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE usuario SET desactivado = true WHERE id = :id"),
                {"id": uuid.UUID(usuario.usuario_id)},
            )

        respuesta = _pedir_reset(app_with_db, usuario.email)

        assert respuesta.status_code == 202
        assert correo.para(usuario.email) == [], (
            "recuperar la contraseña no puede ser una forma de esquivar una baja"
        )


class TestEnvioDelEnlace:
    def test_cuenta_existente_recibe_un_correo_con_el_enlace(self, app_with_db, correo):
        usuario = make_user_client(app_with_db, prefix="env1")

        _pedir_reset(app_with_db, usuario.email)

        mensajes = correo.para(usuario.email)
        assert len(mensajes) == 1
        assert "?token=" in mensajes[0]["cuerpo"]
        assert mensajes[0]["cuerpo"].startswith("Pediste recuperar") or "recuperar" in mensajes[0]["cuerpo"]

    def test_el_enlace_apunta_al_frontend_configurado(self, app_with_db, correo):
        from app.core.config import settings

        usuario = make_user_client(app_with_db, prefix="env2")
        _pedir_reset(app_with_db, usuario.email)

        cuerpo = correo.para(usuario.email)[0]["cuerpo"]
        assert settings.FRONTEND_ORIGIN.rstrip("/") in cuerpo

    def test_solo_se_persiste_el_hash(self, app_with_db, correo, engine):
        usuario = make_user_client(app_with_db, prefix="env3")
        _pedir_reset(app_with_db, usuario.email)

        token = _token_del_correo(correo.para(usuario.email)[0])

        with engine.connect() as conn:
            hashes = conn.execute(
                text("SELECT token_hash FROM token_reset WHERE usuario_id = :id"),
                {"id": uuid.UUID(usuario.usuario_id)},
            ).scalars().all()

        assert token not in hashes
        assert hash_token_reset(token) in hashes


class TestAplicarLaContrasenaNueva:
    def test_reset_exitoso(self, app_with_db, correo):
        usuario = make_user_client(app_with_db, prefix="ap1")
        _pedir_reset(app_with_db, usuario.email)
        token = _token_del_correo(correo.para(usuario.email)[0])

        cliente = make_anon_client(app_with_db)
        respuesta = cliente.post(
            "/api/auth/reset",
            json={"token": token, "password": "nuevapass456"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )
        assert respuesta.status_code == 200, respuesta.text

        login = cliente.post(
            "/api/auth/login",
            json={"email": usuario.email, "password": "nuevapass456"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )
        assert login.status_code == 200

    def test_la_contrasena_anterior_deja_de_servir(self, app_with_db, correo):
        usuario = make_user_client(app_with_db, prefix="ap2")
        _pedir_reset(app_with_db, usuario.email)
        token = _token_del_correo(correo.para(usuario.email)[0])

        cliente = make_anon_client(app_with_db)
        cliente.post(
            "/api/auth/reset",
            json={"token": token, "password": "otradistinta789"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )

        viejo = cliente.post(
            "/api/auth/login",
            json={"email": usuario.email, "password": "testpass123"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )
        assert viejo.status_code == 401

    def test_el_token_no_se_puede_usar_dos_veces(self, app_with_db, correo):
        usuario = make_user_client(app_with_db, prefix="ap3")
        _pedir_reset(app_with_db, usuario.email)
        token = _token_del_correo(correo.para(usuario.email)[0])

        cliente = make_anon_client(app_with_db)
        ip = {"X-Forwarded-For": unique_client_ip()}
        primero = cliente.post(
            "/api/auth/reset", json={"token": token, "password": "primera1234"}, headers=ip
        )
        segundo = cliente.post(
            "/api/auth/reset", json={"token": token, "password": "segunda1234"}, headers=ip
        )

        assert primero.status_code == 200
        assert segundo.status_code == 400

    def test_token_vencido_rechazado(self, app_with_db, correo, engine):
        usuario = make_user_client(app_with_db, prefix="ap4")
        _pedir_reset(app_with_db, usuario.email)
        token = _token_del_correo(correo.para(usuario.email)[0])

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE token_reset SET expira_en = :pasado WHERE token_hash = :h"),
                {
                    "pasado": datetime.now(timezone.utc) - timedelta(minutes=1),
                    "h": hash_token_reset(token),
                },
            )

        cliente = make_anon_client(app_with_db)
        respuesta = cliente.post(
            "/api/auth/reset",
            json={"token": token, "password": "loquesea1234"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )
        assert respuesta.status_code == 400

    def test_los_tres_modos_de_fallo_son_indistinguibles(self, app_with_db, correo, engine):
        usuario = make_user_client(app_with_db, prefix="ap5")

        _pedir_reset(app_with_db, usuario.email)
        usado = _token_del_correo(correo.para(usuario.email)[0])
        cliente = make_anon_client(app_with_db)
        cliente.post(
            "/api/auth/reset",
            json={"token": usado, "password": "consumido123"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )

        correo.enviados.clear()
        _pedir_reset(app_with_db, usuario.email)
        vencido = _token_del_correo(correo.para(usuario.email)[0])
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE token_reset SET expira_en = :p WHERE token_hash = :h"),
                {
                    "p": datetime.now(timezone.utc) - timedelta(minutes=1),
                    "h": hash_token_reset(vencido),
                },
            )

        respuestas = []
        for token in ("inexistente-del-todo", vencido, usado):
            r = make_anon_client(app_with_db).post(
                "/api/auth/reset",
                json={"token": token, "password": "algovalido123"},
                headers={"X-Forwarded-For": unique_client_ip()},
            )
            respuestas.append((r.status_code, r.json()))

        assert len({r[0] for r in respuestas}) == 1, "los estados delatan el motivo"
        assert len({str(r[1]) for r in respuestas}) == 1, "los mensajes delatan el motivo"

    def test_contrasena_corta_no_consume_el_token(self, app_with_db, correo):
        """D4: un typo no puede mandarte de vuelta a la casilla de correo."""
        usuario = make_user_client(app_with_db, prefix="ap6")
        _pedir_reset(app_with_db, usuario.email)
        token = _token_del_correo(correo.para(usuario.email)[0])

        cliente = make_anon_client(app_with_db)
        ip = {"X-Forwarded-For": unique_client_ip()}
        corta = cliente.post(
            "/api/auth/reset", json={"token": token, "password": "corta"}, headers=ip
        )
        assert corta.status_code == 422

        buena = cliente.post(
            "/api/auth/reset", json={"token": token, "password": "ahoraSiValida1"}, headers=ip
        )
        assert buena.status_code == 200, "el token se consumió con la contraseña inválida"

    def test_el_reset_no_deja_sesion_iniciada(self, app_with_db, correo):
        usuario = make_user_client(app_with_db, prefix="ap7")
        _pedir_reset(app_with_db, usuario.email)
        token = _token_del_correo(correo.para(usuario.email)[0])

        cliente = make_anon_client(app_with_db)
        cliente.post(
            "/api/auth/reset",
            json={"token": token, "password": "sinsesion1234"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )

        assert cliente.get("/api/me").status_code == 401


class TestElResetCierraLoQueEstabaAbierto:
    """D3: si la sesión del intruso sobrevive, el reset fue decorativo."""

    def test_las_sesiones_abiertas_no_pueden_renovar(self, app_with_db, correo):
        usuario = make_user_client(app_with_db, prefix="cierra1")
        assert usuario.post("/api/auth/refresh").status_code == 200

        _pedir_reset(app_with_db, usuario.email)
        token = _token_del_correo(correo.para(usuario.email)[0])
        make_anon_client(app_with_db).post(
            "/api/auth/reset",
            json={"token": token, "password": "cerrotodo1234"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )

        assert usuario.post("/api/auth/refresh").status_code == 401

    def test_los_demas_tokens_de_reset_mueren(self, app_with_db, correo):
        usuario = make_user_client(app_with_db, prefix="cierra2")

        _pedir_reset(app_with_db, usuario.email)
        _pedir_reset(app_with_db, usuario.email)
        mensajes = correo.para(usuario.email)
        assert len(mensajes) == 2
        primero = _token_del_correo(mensajes[0])
        segundo = _token_del_correo(mensajes[1])

        ip = {"X-Forwarded-For": unique_client_ip()}
        usado = make_anon_client(app_with_db).post(
            "/api/auth/reset", json={"token": segundo, "password": "usoelsegundo1"}, headers=ip
        )
        assert usado.status_code == 200

        sobrante = make_anon_client(app_with_db).post(
            "/api/auth/reset", json={"token": primero, "password": "yNoElPrimero1"}, headers=ip
        )
        assert sobrante.status_code == 400, "un token viejo sobrevivió al reset"

    def test_las_sesiones_de_otros_no_se_tocan(self, app_with_db, correo):
        uno = make_user_client(app_with_db, prefix="cierra3a")
        otro = make_user_client(app_with_db, prefix="cierra3b")

        _pedir_reset(app_with_db, uno.email)
        token = _token_del_correo(correo.para(uno.email)[0])
        make_anon_client(app_with_db).post(
            "/api/auth/reset",
            json={"token": token, "password": "soloelmio123"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )

        assert otro.get("/api/me").status_code == 200
        assert otro.post("/api/auth/refresh").status_code == 200


class TestTopeDePendientes:
    def test_los_pedidos_repetidos_no_acumulan_tokens_vivos(self, app_with_db, correo, engine):
        from app.core.config import settings

        usuario = make_user_client(app_with_db, prefix="tope")
        for _ in range(settings.RESET_TOKENS_PENDIENTES_MAX + 3):
            _pedir_reset(app_with_db, usuario.email)

        with engine.connect() as conn:
            vivos = conn.execute(
                text(
                    "SELECT count(*) FROM token_reset "
                    "WHERE usuario_id = :id AND usado_en IS NULL AND expira_en > now()"
                ),
                {"id": uuid.UUID(usuario.usuario_id)},
            ).scalar()

        assert vivos <= settings.RESET_TOKENS_PENDIENTES_MAX

    def test_el_ultimo_enlace_siempre_funciona(self, app_with_db, correo):
        usuario = make_user_client(app_with_db, prefix="tope2")
        for _ in range(5):
            _pedir_reset(app_with_db, usuario.email)

        ultimo = _token_del_correo(correo.para(usuario.email)[-1])
        respuesta = make_anon_client(app_with_db).post(
            "/api/auth/reset",
            json={"token": ultimo, "password": "elultimoSirve1"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )
        assert respuesta.status_code == 200


class TestProveedorDeCorreo:
    def test_el_default_es_consola(self, env_vars, monkeypatch):
        """Un default que enviara de verdad mandaría correos desde una laptop."""
        monkeypatch.delenv("EMAIL_PROVIDER", raising=False)
        from app.core.email import ConsoleEmailSender, get_email_sender

        assert isinstance(get_email_sender(), ConsoleEmailSender)

    def test_la_consola_no_abre_red(self, env_vars):
        from app.core.email import ConsoleEmailSender

        emisor = ConsoleEmailSender()
        emisor.enviar("alguien@test.com", "Asunto", "Cuerpo")

        assert emisor.enviados[0]["destinatario"] == "alguien@test.com"

    def test_la_consola_realmente_imprime_el_enlace(self, env_vars, capsys):
        """Lo que este proveedor tiene que hacer es ser LEGIBLE.

        Guardar el mensaje en memoria no sirve de nada si el desarrollador no
        puede verlo: con la config de logging de uvicorn, un INFO de este
        módulo no llega a la consola. Se descubrió corriendo el flujo real —
        el token se creaba, la respuesta era 202, y el enlace no aparecía por
        ningún lado.
        """
        from app.core.email import ConsoleEmailSender

        ConsoleEmailSender().enviar(
            "alguien@test.com", "Recuperá tu contraseña", "http://x/reset?token=abc123"
        )

        salida = capsys.readouterr().out
        assert "alguien@test.com" in salida
        assert "reset?token=abc123" in salida

    def test_smtp_falla_ruidoso_en_lugar_de_no_hacer_nada(self, env_vars):
        """Creer que mandaste un enlace que nunca saliste es peor que fallar."""
        from app.core.email import SmtpEmailSender

        with pytest.raises(NotImplementedError):
            SmtpEmailSender().enviar("a@test.com", "x", "y")
