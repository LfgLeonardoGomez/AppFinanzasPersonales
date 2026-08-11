## 1. Red de seguridad

- [ ] 1.1 Correr la suite del frontend y registrar el baseline (`npm test`), más `tsc --noEmit` y `npm run lint`. Un fallo previo se reporta como preexistente y NO se arregla acá.

## 2. Sincronizar el contrato (va primero y en su propio commit — D1)

- [ ] 2.1 Verificar que el contenedor `api` esté corriendo el código de C-29: `GET /openapi.json` debe incluir `/api/equipo` y `/api/auth/registro-empleado`. Regenerar contra un backend viejo deja los tipos peor, en silencio.
- [ ] 2.2 Correr `npm run generate-types` y revisar el diff: debe aparecer `negocio_id` en proveedor/factura/pago, desaparecer `usuario_id`, y sumarse los tipos de equipo.
- [ ] 2.3 Correr `tsc --noEmit` y listar TODO lo que rompa antes de tocar nada. Esa lista es el alcance de la tarea 2.4.
- [ ] 2.4 Corregir `FacturaFormPage.tsx` (único uso de producción) y los fixtures de test afectados. Regla: si un test falla por algo que no sea el nombre del campo, se **reporta**, no se ajusta.
- [ ] 2.5 Test: la edición de una factura existente sigue mostrando el nombre del proveedor (que era lo que ese objeto de display servía).
- [ ] 2.6 Verificar `tsc --noEmit`, `npm run lint` y la suite en verde. Commitear **solo esto**.

## 3. Capa de API y sesión

- [ ] 3.1 Test: los hooks de equipo llaman a los endpoints correctos (`GET /api/equipo`, `POST /api/equipo/invitaciones`, `desactivar`, `reactivar`).
- [ ] 3.2 Test: el hook de alta por invitación pega a `/api/auth/registro-empleado`, nunca a `/api/auth/registro`.
- [ ] 3.3 Implementar `src/features/equipo/api/equipoHooks.ts` con TanStack Query, invalidando el listado tras cada mutación.
- [ ] 3.4 Verificar que el store de sesión exponga `es_admin` desde `/api/me` (ya viene en `UsuarioResponse` desde C-28); si falta, propagarlo.

## 4. Registro con dos caminos

- [ ] 4.1 Test: el selector cambia los campos — el camino de invitación pide código y NO pide nombre de negocio.
- [ ] 4.2 Test: cada camino envía al endpoint que le corresponde (la confusión silenciosa es el modo de falla que importa, D2).
- [ ] 4.3 Test: código vacío en el camino de invitación no envía el formulario.
- [ ] 4.4 Test: un 400 del backend muestra el mensaje único, sin inventar el motivo (D-41), y orienta a pedir otro código.
- [ ] 4.5 Test: ambos caminos dejan la sesión iniciada al completarse.
- [ ] 4.6 Implementar los dos caminos en `RegisterPage`.

## 5. Pantalla de equipo

- [ ] 5.1 Test: lista miembros con nombre, email y estado, **incluidos los desactivados**, distinguiendo administradores.
- [ ] 5.2 Test: estado vacío (solo el admin) se muestra sin errores y ofrece invitar.
- [ ] 5.3 Test: la entrada de navegación no se renderiza para un usuario sin `es_admin`.
- [ ] 5.4 Test: el acceso directo por URL sin privilegio no muestra datos del equipo.
- [ ] 5.5 Implementar `src/features/equipo/EquipoPage.tsx` + la ruta y la entrada de navegación condicionada.

## 6. Invitación y cambios de acceso

- [ ] 6.1 Test: al generar, el código se muestra, hay control para copiarlo y hay advertencia explícita de que no se recupera.
- [ ] 6.2 Test: cerrado el diálogo, el código no aparece en ninguna pantalla.
- [ ] 6.3 Test: el diálogo NO se cierra con click en el backdrop (mismo criterio que `DeleteProveedorDialog`, D-25/D3).
- [ ] 6.4 Test: desactivar pide confirmación y aclara que los registros de la persona se conservan.
- [ ] 6.5 Test: un 409 se muestra explicando que el negocio quedaría sin administración, distinguible de un error genérico (D5).
- [ ] 6.6 Test: el listado refleja desactivar y reactivar sin recargar la página.
- [ ] 6.7 Implementar el diálogo de invitación y las acciones de desactivar/reactivar con su confirmación.

## 7. Cierre

- [ ] 7.1 Correr `tsc --noEmit`, `npm run lint` y la suite completa; comparar contra el baseline de 1.1.
- [ ] 7.2 Levantar la app y recorrer el flujo real: crear negocio → invitar → sumarse con el código desde otra sesión → desactivar → verificar que el desactivado queda afuera.
- [ ] 7.3 Actualizar `knowledge-base/06_funcionalidades.md` y `07_flujos_principales.md` con el flujo de alta por invitación.
- [ ] 7.4 Marcar C-30 en `CHANGES.md` y dejar constancia de que la deuda de `usuario_id` quedó saldada.
