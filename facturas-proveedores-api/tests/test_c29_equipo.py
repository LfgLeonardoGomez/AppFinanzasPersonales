"""
C-29 — team management, end to end.

What actually needs proving here is not that the endpoints return 200. It is:

- an outsider cannot see or touch another shop's team,
- a member without the flag cannot manage anyone,
- a revoked member is out on their next request AND cannot renew,
- a shop can never be left with nobody able to administer it,
- and a public endpoint that eats invitation codes cannot be used to discover
  which shops exist.

Driven over HTTP wherever the rule is enforced at that boundary, because that
is the boundary an attacker meets.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401 — register table metadata
from tests.conftest import make_anon_client, make_user_client, unique_client_ip, unique_test_email


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def app_with_db(engine, env_vars):
    """App wired to the test DB.

    Overrides are written out one per router (never a loop): the C-25 guard
    walks the AST to prove each key is imported from an `app.routers.*` module.
    """
    from app.core.deps import reset_rate_limit_store
    from app.main import app
    from app.routers.auth import get_db as get_db_auth
    from app.routers.equipo import get_db as get_db_equipo
    from app.routers.facturas import get_db as get_db_facturas
    from app.routers.pagos import get_db as get_db_pagos
    from app.routers.proveedores import get_db as get_db_proveedores
    from app.routers.usuarios import get_db as get_db_usuarios

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db_auth] = override_get_db
    app.dependency_overrides[get_db_usuarios] = override_get_db
    app.dependency_overrides[get_db_equipo] = override_get_db
    app.dependency_overrides[get_db_proveedores] = override_get_db
    app.dependency_overrides[get_db_facturas] = override_get_db
    app.dependency_overrides[get_db_pagos] = override_get_db

    yield app

    app.dependency_overrides.clear()


def _invitar(admin: TestClient) -> str:
    """Issue a code through the API and return the readable value."""
    respuesta = admin.post(
        "/api/equipo/invitaciones", headers={"X-Forwarded-For": unique_client_ip()}
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["codigo"]


def _sumarse(app, codigo: str, *, password="testpass123") -> tuple[TestClient, dict]:
    """Register through the public employee route and log the new member in."""
    cliente = make_anon_client(app)
    email = unique_test_email("emp")
    ip = {"X-Forwarded-For": unique_client_ip()}

    alta = cliente.post(
        "/api/auth/registro-empleado",
        json={"email": email, "nombre": "Empleado", "password": password, "codigo": codigo},
        headers=ip,
    )
    if alta.status_code != 201:
        return cliente, alta.json() if alta.content else {}

    login = cliente.post(
        "/api/auth/login", json={"email": email, "password": password}, headers=ip
    )
    assert login.status_code == 200, login.text
    me = cliente.get("/api/me").json()
    cliente.usuario_id = me["id"]
    cliente.negocio_id = me["negocio_id"]
    cliente.email = email
    return cliente, alta.json()


class TestInvitacionYAlta:
    def test_employee_joins_the_admins_negocio(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="adm")
        codigo = _invitar(admin)

        empleado, cuerpo = _sumarse(app_with_db, codigo)

        assert cuerpo["negocio_id"] == admin.negocio_id
        assert cuerpo["es_admin"] is False
        assert empleado.negocio_id == admin.negocio_id

    def test_employee_signup_creates_no_new_negocio(self, app_with_db, engine):
        admin = make_user_client(app_with_db, prefix="adm2")
        with engine.connect() as conn:
            antes = conn.execute(text("SELECT count(*) FROM negocio")).scalar()

        _sumarse(app_with_db, _invitar(admin))

        with engine.connect() as conn:
            despues = conn.execute(text("SELECT count(*) FROM negocio")).scalar()
        assert despues == antes, "el alta de empleado creó un negocio"

    def test_the_code_is_shown_once_and_only_as_a_hash_after(self, app_with_db, engine):
        admin = make_user_client(app_with_db, prefix="adm3")
        codigo = _invitar(admin)

        with engine.connect() as conn:
            filas = conn.execute(
                text("SELECT codigo_hash FROM invitacion_empleado")
            ).scalars().all()

        assert codigo not in filas
        assert all(len(h) == 64 for h in filas)

    def test_a_code_cannot_be_used_twice(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="adm4")
        codigo = _invitar(admin)

        _, primero = _sumarse(app_with_db, codigo)
        assert primero.get("es_admin") is False

        _, segundo = _sumarse(app_with_db, codigo)
        assert "id" not in segundo, "el mismo código sirvió dos veces"

    def test_expired_code_is_rejected(self, app_with_db, engine):
        admin = make_user_client(app_with_db, prefix="adm5")
        codigo = _invitar(admin)

        from app.core.security import hash_codigo_invitacion

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE invitacion_empleado SET expira_en = :pasado WHERE codigo_hash = :h"),
                {
                    "pasado": datetime.now(timezone.utc) - timedelta(hours=1),
                    "h": hash_codigo_invitacion(codigo),
                },
            )

        _, cuerpo = _sumarse(app_with_db, codigo)
        assert "id" not in cuerpo

    def test_the_three_failure_modes_are_indistinguishable(self, app_with_db, engine):
        """D3: unknown / expired / used must not be tellable apart."""
        from app.core.security import hash_codigo_invitacion

        admin = make_user_client(app_with_db, prefix="adm6")

        inexistente = "ZZZZ2345"

        vencido = _invitar(admin)
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE invitacion_empleado SET expira_en = :p WHERE codigo_hash = :h"),
                {
                    "p": datetime.now(timezone.utc) - timedelta(hours=1),
                    "h": hash_codigo_invitacion(vencido),
                },
            )

        usado = _invitar(admin)
        _sumarse(app_with_db, usado)

        respuestas = []
        for codigo in (inexistente, vencido, usado):
            cliente = make_anon_client(app_with_db)
            r = cliente.post(
                "/api/auth/registro-empleado",
                json={
                    "email": unique_test_email("probe"),
                    "nombre": "Probe",
                    "password": "testpass123",
                    "codigo": codigo,
                },
                headers={"X-Forwarded-For": unique_client_ip()},
            )
            respuestas.append((r.status_code, r.json()))

        estados = {r[0] for r in respuestas}
        mensajes = {str(r[1]) for r in respuestas}
        assert len(estados) == 1, f"los estados delatan el motivo: {estados}"
        assert len(mensajes) == 1, f"los mensajes delatan el motivo: {mensajes}"

    def test_duplicate_email_does_not_burn_the_invitation(self, app_with_db):
        """D4: a typo must not force the admin to issue another code."""
        admin = make_user_client(app_with_db, prefix="adm7")
        codigo = _invitar(admin)

        ocupado = make_user_client(app_with_db, prefix="taken")

        cliente = make_anon_client(app_with_db)
        choque = cliente.post(
            "/api/auth/registro-empleado",
            json={
                "email": ocupado.email,
                "nombre": "Colisión",
                "password": "testpass123",
                "codigo": codigo,
            },
            headers={"X-Forwarded-For": unique_client_ip()},
        )
        assert choque.status_code == 409, choque.text

        _, cuerpo = _sumarse(app_with_db, codigo)
        assert cuerpo.get("es_admin") is False, "la invitación se consumió en el fallo"

    def test_payload_cannot_ask_for_admin(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="adm8")
        codigo = _invitar(admin)

        cliente = make_anon_client(app_with_db)
        alta = cliente.post(
            "/api/auth/registro-empleado",
            json={
                "email": unique_test_email("greedy"),
                "nombre": "Ambicioso",
                "password": "testpass123",
                "codigo": codigo,
                "es_admin": True,
            },
            headers={"X-Forwarded-For": unique_client_ip()},
        )
        assert alta.status_code in (201, 422)
        if alta.status_code == 201:
            assert alta.json()["es_admin"] is False


class TestPrivilegio:
    def test_only_admin_lists_the_team(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="pa")
        empleado, _ = _sumarse(app_with_db, _invitar(admin))

        assert admin.get("/api/equipo").status_code == 200
        assert empleado.get("/api/equipo").status_code == 403

    def test_only_admin_issues_invitations(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="pb")
        empleado, _ = _sumarse(app_with_db, _invitar(admin))

        respuesta = empleado.post(
            "/api/equipo/invitaciones", headers={"X-Forwarded-For": unique_client_ip()}
        )
        assert respuesta.status_code == 403

    def test_only_admin_deactivates(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="pc")
        primero, _ = _sumarse(app_with_db, _invitar(admin))
        segundo, _ = _sumarse(app_with_db, _invitar(admin))

        respuesta = primero.post(f"/api/equipo/{segundo.usuario_id}/desactivar")
        assert respuesta.status_code == 403
        assert segundo.get("/api/me").status_code == 200

    def test_the_team_listing_does_not_cross_negocios(self, app_with_db):
        admin_a = make_user_client(app_with_db, prefix="ca")
        admin_b = make_user_client(app_with_db, prefix="cb")
        _sumarse(app_with_db, _invitar(admin_b))

        equipo = admin_a.get("/api/equipo").json()
        ids = {m["id"] for m in equipo}

        assert ids == {admin_a.usuario_id}

    def test_cannot_deactivate_a_member_of_another_negocio(self, app_with_db):
        admin_a = make_user_client(app_with_db, prefix="da")
        admin_b = make_user_client(app_with_db, prefix="db")
        ajeno, _ = _sumarse(app_with_db, _invitar(admin_b))

        respuesta = admin_a.post(f"/api/equipo/{ajeno.usuario_id}/desactivar")
        assert respuesta.status_code == 404
        assert ajeno.get("/api/me").status_code == 200

    def test_no_route_grants_admin(self, app_with_db):
        """D7: es_admin is not something the API hands out in this change."""
        rutas = {r.path for r in app_with_db.routes}
        sospechosas = {
            r for r in rutas if "promov" in r or "admin" in r.lower() or "rol" in r
        }
        assert not sospechosas, f"apareció una ruta de privilegio: {sospechosas}"


class TestRevocacionDeAcceso:
    def test_deactivated_member_is_out_on_the_next_request(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="ra")
        empleado, _ = _sumarse(app_with_db, _invitar(admin))
        assert empleado.get("/api/me").status_code == 200

        assert admin.post(f"/api/equipo/{empleado.usuario_id}/desactivar").status_code == 200
        assert empleado.get("/api/me").status_code == 401

    def test_deactivated_member_cannot_renew_the_session(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="rb")
        empleado, _ = _sumarse(app_with_db, _invitar(admin))

        admin.post(f"/api/equipo/{empleado.usuario_id}/desactivar")

        renovacion = empleado.post("/api/auth/refresh")
        assert renovacion.status_code == 401, (
            "un miembro revocado pudo renovar su sesión con el refresh token"
        )

    def test_the_deactivated_members_records_survive(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="rc")
        empleado, _ = _sumarse(app_with_db, _invitar(admin))

        proveedor = empleado.post(
            "/api/proveedores", json={"nombre": "Cargado por el empleado"}
        )
        assert proveedor.status_code == 201, proveedor.text

        admin.post(f"/api/equipo/{empleado.usuario_id}/desactivar")

        visto = admin.get(f"/api/proveedores/{proveedor.json()['id']}")
        assert visto.status_code == 200
        assert visto.json()["nombre"] == "Cargado por el empleado"

    def test_reactivating_restores_access(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="rd")
        empleado, _ = _sumarse(app_with_db, _invitar(admin))

        admin.post(f"/api/equipo/{empleado.usuario_id}/desactivar")
        assert empleado.get("/api/me").status_code == 401

        assert admin.post(f"/api/equipo/{empleado.usuario_id}/reactivar").status_code == 200

        # The real proof is a fresh login, not the flag in the listing: the
        # member has to be able to get back in.
        cliente = make_anon_client(app_with_db)
        login = cliente.post(
            "/api/auth/login",
            json={"email": empleado.email, "password": "testpass123"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )
        assert login.status_code == 200, login.text
        assert cliente.get("/api/me").status_code == 200

    def test_the_listing_shows_deactivated_members(self, app_with_db):
        """An admin cannot reactivate someone they cannot see."""
        admin = make_user_client(app_with_db, prefix="re")
        empleado, _ = _sumarse(app_with_db, _invitar(admin))
        admin.post(f"/api/equipo/{empleado.usuario_id}/desactivar")

        equipo = admin.get("/api/equipo").json()
        fila = next((m for m in equipo if m["id"] == empleado.usuario_id), None)

        assert fila is not None, "el desactivado desapareció del listado"
        assert fila["desactivado"] is True


class TestGuardaDeUltimoAdmin:
    def test_the_only_admin_cannot_deactivate_themselves(self, app_with_db):
        admin = make_user_client(app_with_db, prefix="ga")

        respuesta = admin.post(f"/api/equipo/{admin.usuario_id}/desactivar")

        assert respuesta.status_code == 409, respuesta.text
        assert admin.get("/api/me").status_code == 200, "el admin se dejó sin acceso"

    def test_the_rejection_explains_itself(self, app_with_db):
        """A 404 would be a lie: the member exists and the caller may act.

        The admin has to be able to tell "you cannot do this" apart from
        "that does not exist", otherwise the only way forward is guessing.
        """
        admin = make_user_client(app_with_db, prefix="gb")
        respuesta = admin.post(f"/api/equipo/{admin.usuario_id}/desactivar")

        assert respuesta.status_code == 409
        detalle = respuesta.json()["detail"].lower()
        assert "administrador" in detalle or "admin" in detalle

    def test_a_negocio_always_keeps_an_active_admin(self, app_with_db, engine):
        admin = make_user_client(app_with_db, prefix="gc")
        empleado, _ = _sumarse(app_with_db, _invitar(admin))

        admin.post(f"/api/equipo/{empleado.usuario_id}/desactivar")
        admin.post(f"/api/equipo/{admin.usuario_id}/desactivar")

        with engine.connect() as conn:
            activos = conn.execute(
                text(
                    "SELECT count(*) FROM usuario "
                    "WHERE negocio_id = :n AND es_admin = true AND desactivado = false"
                ),
                {"n": uuid.UUID(admin.negocio_id)},
            ).scalar()

        assert activos >= 1, "el negocio quedó sin administración"
