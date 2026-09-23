import { Hono } from 'hono'
import { corsMiddleware } from './middleware/cors'
import { errorMiddleware } from './middleware/error'

// UMAS
import auth from './routes/umas/auth'
import usersRouter from './routes/umas/users'
import tenantsRouter from './routes/umas/tenants'
import membersRouter from './routes/umas/members'
import rolesRouter from './routes/umas/roles'
import positionsRouter from './routes/umas/positions'

// Core - CRM
import clientsRouter from './routes/core/crm/clients'
import bookingsRouter from './routes/core/crm/bookings'
import warrantiesRouter from './routes/core/crm/warranties'
import quotationRouter from './routes/core/crm/quotations'

// Core - HRIS
import attendancesRouter from './routes/core/hris/attendances'
import leavesRouter from './routes/core/hris/leaves'
import overtimeRouter from './routes/core/hris/overtime'
import payrollRouter from './routes/core/hris/payroll'

// Core - Finance
import expenseCategoriesRouter from './routes/core/finance/expense-categories'
import expenseClaimsRouter from './routes/core/finance/expense-claims'
import departmentBudgetsRouter from './routes/core/finance/department-budgets'
import invoicesRouter from './routes/core/finance/invoices'

// Core - Compliance
import auditLogsRouter from './routes/core/compliance/audit-logs'
import supportTicketsRouter from './routes/core/compliance/support-tickets'

// Core - Project
import projectsRouter from './routes/core/project/projects'
import tasksRouter from './routes/core/project/tasks'
import tagsRouter from './routes/core/project/tags'

// Core - Catalog
import catalogCategoriesRouter from './routes/core/catalog/categories'
import catalogItemsRouter from './routes/core/catalog/items'
import subscriptionsRouter from './routes/core/catalog/subscriptions'

// Core - Procurement
import suppliersRouter from './routes/core/procurement/suppliers'
import posRouter from './routes/core/procurement/pos'
import stockMovementsRouter from './routes/core/procurement/stock-movements'

// Fast
import shiftsRouter from './routes/fast/shifts'
import notifications from './routes/fast/notifications'
import approvalsRouter from './routes/fast/approvals'

// Complimentary
import assetsRouter from './routes/complimentary/assets'
import purchaseRequestsRouter from './routes/complimentary/procurement/purchase-requests'
import vendorsRouter from './routes/complimentary/procurement/vendors'
import purchaseOrdersRouter from './routes/complimentary/procurement/purchase-orders'
import goodsReceiptsRouter from './routes/complimentary/procurement/goods-receipts'

const app = new Hono()

app.use('*', corsMiddleware)
app.use('*', errorMiddleware)

app.get('/', (c) => {
  return c.json({ name: 'hub-backend', version: '0.1.0', status: 'ok' })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ============ UMAS ============
app.route('/api/auth', auth)
app.route('/api/users', usersRouter)
app.route('/api/tenants', tenantsRouter)
app.route('/api/members', membersRouter)
app.route('/api/roles', rolesRouter)
app.route('/api/positions', positionsRouter)

// ============ CORE ============
app.route('/api/clients', clientsRouter)
app.route('/api/bookings', bookingsRouter)
app.route('/api/warranties', warrantiesRouter)
app.route('/api/quotations', quotationRouter)
app.route('/api/hris/attendances', attendancesRouter)
app.route('/api/hris/leaves', leavesRouter)
app.route('/api/hris/overtime', overtimeRouter)
app.route('/api/hris/payroll', payrollRouter)
app.route('/api/finance/expense-categories', expenseCategoriesRouter)
app.route('/api/finance/expense-claims', expenseClaimsRouter)
app.route('/api/finance/department-budgets', departmentBudgetsRouter)
app.route('/api/finance/invoices', invoicesRouter)
app.route('/api/compliance/audit-logs', auditLogsRouter)
app.route('/api/compliance/tickets', supportTicketsRouter)
app.route('/api/projects', projectsRouter)
app.route('/api/tasks', tasksRouter)
app.route('/api/tags', tagsRouter)
app.route('/api/catalog/categories', catalogCategoriesRouter)
app.route('/api/catalog/items', catalogItemsRouter)
app.route('/api/catalog/subscriptions', subscriptionsRouter)
app.route('/api/suppliers', suppliersRouter)
app.route('/api/pos', posRouter)
app.route('/api/stock-movements', stockMovementsRouter)

// ============ FAST ============
app.route('/api/hris/shifts', shiftsRouter)
app.route('/api/notifications', notifications)
app.route('/api/approvals', approvalsRouter)

// ============ COMPLIMENTARY ============
app.route('/api/assets', assetsRouter)
app.route('/api/procurement/purchase-requests', purchaseRequestsRouter)
app.route('/api/procurement/vendors', vendorsRouter)
app.route('/api/procurement/purchase-orders', purchaseOrdersRouter)
app.route('/api/procurement/goods-receipts', goodsReceiptsRouter)

export default app
