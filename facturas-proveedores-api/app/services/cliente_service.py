"""
ClienteService — customer identity and its one hard rule (C-32).

All authorization lives here: everything is scoped by `negocio_id`, and a
customer of another negocio is 404, never 403 (D-06).

The rule this service exists to protect: **two equivalent names cannot coexist
in one negocio**. It is enforced twice, on purpose.

- A lookup before inserting, so the 409 can name the existing customer. The
  employee is standing at the counter; "already exists" without saying *which*
  one leaves them stuck.
- The partial unique index in the database, which is what makes the rule
  actually true. Between the lookup and the insert there is a window, and two
  employees loading the same customer at once will find it. The IntegrityError
  is caught and translated to the same 409, so the loser of that race gets an
  explanation rather than a 500.

The check exists for the message; the index exists for the guarantee.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, Sequence

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core.normalizacion import normalizar_nombre
from app.models.cliente import Cliente
from app.repositories.cliente_repository import ClienteRepository

_CLIENTE_NO_ENCONTRADO = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Cliente not found",
)


def _conflicto(existente: Optional[Cliente]) -> HTTPException:
    """409 carrying the existing customer, so the caller can offer it.

    Without the id there is nothing the UI can do but show an error; with it,
    it can say "¿quisiste decir este?" and let the employee pick.
    """
    detalle: dict = {"mensaje": "Ya existe un cliente con ese nombre en este negocio."}
    if existente is not None:
        detalle["cliente_existente"] = {
            "id": str(existente.id),
            "nombre": existente.nombre,
        }
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detalle)


class ClienteService:
    """Customer CRUD and search, scoped to one negocio."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repo = ClienteRepository(session)

    # ── helpers ───────────────────────────────────────────────────────────────

    def _get_propio(self, negocio_id: uuid.UUID, cliente_id: uuid.UUID) -> Cliente:
        cliente = self._repo.get(negocio_id, cliente_id)
        if cliente is None:
            raise _CLIENTE_NO_ENCONTRADO
        return cliente

    # ── lectura ───────────────────────────────────────────────────────────────

    def listar(self, negocio_id: uuid.UUID) -> Sequence[Cliente]:
        return self._repo.listar(negocio_id)

    def buscar(self, negocio_id: uuid.UUID, texto: str) -> Sequence[Cliente]:
        """Autocomplete. The query is normalized with the same rule as the alta.

        Using a different rule here would show the employee that nothing
        matches, and then reject their alta as a duplicate.
        """
        return self._repo.buscar(negocio_id, normalizar_nombre(texto))

    def get(self, negocio_id: uuid.UUID, cliente_id: uuid.UUID) -> Cliente:
        return self._get_propio(negocio_id, cliente_id)

    # ── escritura ─────────────────────────────────────────────────────────────

    def crear(
        self,
        negocio_id: uuid.UUID,
        nombre: str,
        telefono: Optional[str] = None,
        notas: Optional[str] = None,
        creado_por_usuario_id: Optional[uuid.UUID] = None,
    ) -> Cliente:
        """Create a customer. `nombre` is the only thing required."""
        normalizado = normalizar_nombre(nombre)

        existente = self._repo.get_by_nombre_normalizado(negocio_id, normalizado)
        if existente is not None:
            raise _conflicto(existente)

        try:
            return self._repo.create(
                negocio_id=negocio_id,
                creado_por_usuario_id=creado_por_usuario_id,
                nombre=nombre.strip(),
                nombre_normalizado=normalizado,
                telefono=telefono,
                notas=notas,
            )
        except IntegrityError:
            # Lost the race against a concurrent alta. Roll back so the session
            # is usable, then answer like any other duplicate.
            self._session.rollback()
            raise _conflicto(
                self._repo.get_by_nombre_normalizado(negocio_id, normalizado)
            )

    def actualizar(
        self,
        negocio_id: uuid.UUID,
        cliente_id: uuid.UUID,
        nombre: Optional[str] = None,
        telefono: Optional[str] = None,
        notas: Optional[str] = None,
    ) -> Cliente:
        """
        Partial update. Renaming recomputes the normalized form, so a rename
        into an existing name is rejected exactly like a duplicate alta.
        """
        cliente = self._get_propio(negocio_id, cliente_id)

        if nombre is not None:
            normalizado = normalizar_nombre(nombre)
            existente = self._repo.get_by_nombre_normalizado(negocio_id, normalizado)
            if existente is not None and existente.id != cliente.id:
                raise _conflicto(existente)
            cliente.nombre = nombre.strip()
            cliente.nombre_normalizado = normalizado

        if telefono is not None:
            cliente.telefono = telefono
        if notas is not None:
            cliente.notas = notas

        self._session.add(cliente)
        try:
            self._session.flush()
        except IntegrityError:
            self._session.rollback()
            raise _conflicto(None)

        return cliente

    def eliminar(self, negocio_id: uuid.UUID, cliente_id: uuid.UUID) -> Cliente:
        """
        Soft delete. Releases the name: the partial unique index only covers
        active rows, so the shop can re-add someone it had removed.
        """
        cliente = self._get_propio(negocio_id, cliente_id)
        cliente.deleted_at = datetime.now(timezone.utc)
        self._session.add(cliente)
        self._session.flush()
        return cliente


__all__ = ["ClienteService"]
