# Baseline de Seguridad — MVP

Nivel objetivo: **"muy segura dentro de lo normal"** — buenas prácticas estándar para una app con datos personales y registros de pagos. No incluye PCI-DSS ni manejo de tarjetas (la app no transacciona dinero, solo registra).

Cada punto es un requisito que el agente debe implementar; no son sugerencias opcionales.

## 1. Transporte

- **HTTPS/TLS obligatorio** en frontend y backend. Sin HTTP plano en producción.
- El VPS necesita certificado TLS (Let's Encrypt vía Caddy o Nginx como reverse proxy). Vercel ya provee HTTPS.

## 2. Contraseñas

- Hash con **argon2id** (preferido) o **bcrypt**. Nunca texto plano, nunca cifrado reversible.
- Longitud mínima 8 caracteres. **No** truncar ni imponer un máximo bajo.
- No registrar contraseñas en logs bajo ninguna circunstancia.

## 3. Sesión y tokens

- **Access token** de vida corta (ej. 30 min), en cookie `HttpOnly`.
- **Refresh token** para renovar. Con "Recordarme" activado: vida larga (ej. 30 días). Desactivado: cookie de sesión (expira al cerrar el navegador).
- Flags de cookie: `HttpOnly`, `Secure`, y `SameSite` según la estrategia de dominio (ver `03-arquitectura-tecnica.md` → sección cross-origin).
- Logout invalida la sesión del lado servidor cuando se usen tokens revocables/opacos; si se usa JWT puro, mantener TTLs cortos + rotación de refresh.
- `SECRET_KEY` fuerte y secreta; rotación posible sin romper el esquema.

## 4. Autorización y aislamiento de datos

- **Toda** consulta de negocio se filtra por el `usuario_id` del usuario autenticado, en el **service layer**.
- Acceder a un recurso de otro usuario devuelve **404** (no 403), para no revelar la existencia del recurso.
- Verificar las invariantes: una factura/pago solo puede referir a un proveedor del mismo usuario (ver `02-modelo-datos.md`).

## 5. Validación de entrada

- Validar todo con schemas Pydantic en el backend (no confiar solo en validaciones del frontend).
- Reglas concretas: `monto > 0`; fechas no futuras (zona UTC-3); formato de CUIT si se carga; enums acotados.
- Parametrizar siempre las queries (ORM/consultas preparadas) — sin SQL armado por concatenación de strings.

## 6. Archivos subidos

- Aceptar solo **PDF, JPG, PNG**. Validar extensión **y** MIME real, no solo el `content-type` declarado por el cliente.
- Tamaño máximo razonable (ej. 10 MB por archivo).
- Subida a Cloudinary con **upload preset firmado** desde el backend (no un preset abierto sin firma).
- No servir archivos subidos desde el dominio del backend como HTML; Cloudinary los sirve como recursos estáticos.

## 7. Rate limiting

- Limitar intentos en **login** y **registro** (throttle por IP y/o por email) para mitigar fuerza bruta y alta masiva de cuentas.
- Considerar límite en el endpoint de extracción por IA (es costoso por llamada).

## 8. Manejo de errores y enumeración de usuarios

- En login fallido, mensaje **genérico** ("credenciales inválidas"), sin distinguir si el email existe o si la contraseña es la incorrecta.
- En producción, no exponer stack traces ni detalles internos en las respuestas.

## 9. Secretos y configuración

- Todos los secretos en **variables de entorno**, nunca commiteados. `.env` en `.gitignore`.
- Claves de API (visión, Cloudinary) y `DATABASE_URL` fuera del repo.

## 10. Base de datos y backups

- Conexión a Postgres sobre TLS si el acceso es remoto. Usuario de base con **privilegios mínimos** (no superusuario).
- **Backups regulares** (ej. `pg_dump` por cron en el VPS, con retención y copia fuera de la instancia). La confiabilidad de los datos es un requisito explícito del producto.

## 11. CORS

- Solo en el fallback de orígenes separados: origen permitido **explícito** (la URL del frontend), `credentials: true`. Nunca `*` junto con credenciales.

## 12. Dependencias

- Mantener dependencias actualizadas. Revisión básica de vulnerabilidades (ej. `pip-audit` / `npm audit`) antes de deploys importantes.

## 13. Logs

- No registrar contraseñas, tokens, ni URLs firmadas con secretos. Registrar lo necesario para auditoría operativa sin filtrar datos sensibles.
