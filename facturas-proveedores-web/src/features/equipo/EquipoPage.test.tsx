/**
 * Tests for EquipoPage (C-30).
 *
 * What actually needs proving here is not that the list renders. It is:
 *
 *  - a non-admin is not offered the section and sees no team data;
 *  - deactivated members stay visible, because an admin cannot reactivate
 *    someone they cannot see;
 *  - the invitation code is shown with its warning and does NOT survive
 *    closing the dialog — it only exists in that one response;
 *  - the last-admin 409 is explained, not shown as a generic failure, since
 *    a generic error leaves the admin retrying something that will never work.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import type { MiembroResponse } from '@shared/api/api'
import { useAuthStore } from '@features/auth/store/authStore'
import EquipoPage from './EquipoPage'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => {
  server.resetHandlers()
  useAuthStore.setState({ user: null })
})
afterAll(() => server.close())

const ADMIN = {
  id: 'u-admin',
  negocio_id: 'neg-1',
  es_admin: true,
  email: 'admin@test.com',
  nombre: 'Dueña',
  created_at: '2026-01-01',
}

const MIEMBROS: MiembroResponse[] = [
  {
    id: 'u-admin',
    nombre: 'Dueña',
    email: 'admin@test.com',
    es_admin: true,
    desactivado: false,
    created_at: '2026-01-01',
  },
  {
    id: 'u-emp',
    nombre: 'Empleado Activo',
    email: 'emp@test.com',
    es_admin: false,
    desactivado: false,
    created_at: '2026-01-02',
  },
  {
    id: 'u-baja',
    nombre: 'Ex Empleado',
    email: 'ex@test.com',
    es_admin: false,
    desactivado: true,
    created_at: '2026-01-03',
  },
]

function renderEquipo(usuario: typeof ADMIN | null = ADMIN) {
  useAuthStore.setState({ user: usuario })
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EquipoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function listaOk(miembros = MIEMBROS) {
  server.use(http.get('/api/equipo', () => HttpResponse.json(miembros)))
}

describe('EquipoPage — privilegio', () => {
  it('un miembro común no ve datos del equipo', async () => {
    const pedidos: string[] = []
    server.use(
      http.get('/api/equipo', () => {
        pedidos.push('equipo')
        return HttpResponse.json(MIEMBROS)
      }),
    )

    renderEquipo({ ...ADMIN, es_admin: false })

    expect(await screen.findByText(/no tenés permiso/i)).toBeInTheDocument()
    expect(screen.queryByText('Empleado Activo')).not.toBeInTheDocument()
    expect(pedidos).toHaveLength(0)
  })

  it('el admin ve el listado', async () => {
    listaOk()
    renderEquipo()

    expect(await screen.findByText('Empleado Activo')).toBeInTheDocument()
  })
})

describe('EquipoPage — listado', () => {
  it('muestra a los desactivados, no los esconde', async () => {
    listaOk()
    renderEquipo()

    expect(await screen.findByText('Ex Empleado')).toBeInTheDocument()
    expect(screen.getByText(/sin acceso/i)).toBeInTheDocument()
  })

  it('distingue a los administradores', async () => {
    listaOk()
    renderEquipo()

    expect(await screen.findByText(/^admin$/i)).toBeInTheDocument()
  })

  it('estado vacío invita a sumar a alguien', async () => {
    listaOk([])
    renderEquipo()

    expect(await screen.findByText(/todavía estás solo/i)).toBeInTheDocument()
  })
})

describe('EquipoPage — invitación', () => {
  it('muestra el código con su advertencia de que no se recupera', async () => {
    listaOk()
    server.use(
      http.post('/api/equipo/invitaciones', () =>
        HttpResponse.json(
          { id: 'inv-1', codigo: 'A3F7K2QB', expira_en: '2026-08-13T00:00:00Z' },
          { status: 201 },
        ),
      ),
    )
    renderEquipo()

    await userEvent.click(await screen.findByRole('button', { name: /invitar/i }))

    expect(await screen.findByTestId('codigo-invitacion')).toHaveTextContent('A3F7K2QB')
    expect(screen.getByText(/no vas a poder volver a verlo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copiar código/i })).toBeInTheDocument()
  })

  it('el código no sobrevive al cierre del diálogo', async () => {
    listaOk()
    server.use(
      http.post('/api/equipo/invitaciones', () =>
        HttpResponse.json(
          { id: 'inv-1', codigo: 'A3F7K2QB', expira_en: '2026-08-13T00:00:00Z' },
          { status: 201 },
        ),
      ),
    )
    renderEquipo()

    await userEvent.click(await screen.findByRole('button', { name: /invitar/i }))
    await screen.findByTestId('codigo-invitacion')

    await userEvent.click(screen.getByRole('button', { name: /ya lo anoté/i }))

    await waitFor(() =>
      expect(screen.queryByTestId('codigo-invitacion')).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('A3F7K2QB')).not.toBeInTheDocument()
  })

  it('la tecla Escape no cierra el diálogo del código', async () => {
    listaOk()
    server.use(
      http.post('/api/equipo/invitaciones', () =>
        HttpResponse.json(
          { id: 'inv-1', codigo: 'A3F7K2QB', expira_en: '2026-08-13T00:00:00Z' },
          { status: 201 },
        ),
      ),
    )
    renderEquipo()

    await userEvent.click(await screen.findByRole('button', { name: /invitar/i }))
    await screen.findByTestId('codigo-invitacion')

    await userEvent.keyboard('{Escape}')

    // Cerrarlo sin querer pierde el código para siempre: el cierre es deliberado.
    expect(screen.getByTestId('codigo-invitacion')).toBeInTheDocument()
  })
})

describe('EquipoPage — quitar y devolver acceso', () => {
  it('pide confirmación y aclara que los registros se conservan', async () => {
    listaOk()
    renderEquipo()

    await screen.findByText('Empleado Activo')
    await userEvent.click(screen.getAllByRole('button', { name: /quitar acceso/i })[0]!)

    expect(screen.getByText(/todo lo que cargó/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument()
  })

  it('el 409 del último admin se explica, no aparece como error genérico', async () => {
    listaOk()
    server.use(
      http.post('/api/equipo/:id/desactivar', () =>
        HttpResponse.json({ detail: 'último admin' }, { status: 409 }),
      ),
    )
    renderEquipo()

    await screen.findByText('Dueña')
    await userEvent.click(screen.getAllByRole('button', { name: /quitar acceso/i })[0]!)
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }))

    const alerta = await screen.findByText(/único administrador activo/i)
    expect(alerta).toBeInTheDocument()
    expect(screen.queryByText(/intentá de nuevo/i)).not.toBeInTheDocument()
  })

  it('un desactivado ofrece reactivar en lugar de quitar acceso', async () => {
    listaOk()
    renderEquipo()

    await screen.findByText('Ex Empleado')
    expect(screen.getByRole('button', { name: /reactivar/i })).toBeInTheDocument()
  })

  it('reactivar refresca el listado', async () => {
    let llamado = false
    server.use(
      http.get('/api/equipo', () =>
        HttpResponse.json(
          llamado
            ? MIEMBROS.map((m) =>
                m.id === 'u-baja' ? { ...m, desactivado: false } : m,
              )
            : MIEMBROS,
        ),
      ),
      http.post('/api/equipo/:id/reactivar', () => {
        llamado = true
        return HttpResponse.json({ ...MIEMBROS[2], desactivado: false })
      }),
    )
    renderEquipo()

    await screen.findByText('Ex Empleado')
    await userEvent.click(screen.getByRole('button', { name: /reactivar/i }))

    await waitFor(() =>
      expect(screen.queryByText(/sin acceso/i)).not.toBeInTheDocument(),
    )
  })
})
