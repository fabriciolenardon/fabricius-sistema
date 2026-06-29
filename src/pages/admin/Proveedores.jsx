// Proveedores.jsx — Cuenta corriente, compras y pagos a proveedores.
// El contenido vive en ProveedoresTab (definido en Deposito.jsx); acá solo se
// expone como página propia para el menú Finanzas (antes era una pestaña de
// Depósito). Reubicado a pedido de Fabricio (29/06/2026).
import { ProveedoresTab } from './Deposito'

export default function Proveedores() {
  return (
    <div>
      <div className="page-title">PROVEEDORES</div>
      <div className="page-sub">Cuenta corriente, compras y pagos a proveedores</div>
      <ProveedoresTab />
    </div>
  )
}
