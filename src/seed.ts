import { db } from './db'
import { users, tenants, tenantMembers, clients, projects, kanbanColumns, tasks, invoices, catalogItems } from './db/schema'
import { eq } from 'drizzle-orm'
import { hashPassword } from './lib/password'

async function seed() {
  console.log('Seeding database...')

  const adminPassword = await hashPassword('admin123')

  let admin = await db.query.users.findFirst({ where: eq(users.email, 'admin@hub.com') })
  if (!admin) {
    const [created] = await db.insert(users).values({
      email: 'admin@hub.com',
      fullName: 'Admin Hub',
      passwordHash: adminPassword,
      role: 'admin',
      platformRole: 'owner',
      status: 'active',
    }).returning()
    admin = created
    console.log('Created admin user: admin@hub.com')
  } else {
    console.log('Admin user already exists, skipping.')
  }

  const [tenant1] = await db.insert(tenants).values({
    name: 'PT Maju Jaya',
    slug: 'pt-maju-jaya',
    dbSchema: 'tenant_maju_jaya',
    plan: 'pro',
    status: 'active',
  }).returning()
  console.log('Created tenant: PT Maju Jaya')

  const [_tenant2] = await db.insert(tenants).values({
    name: 'CV Berkah Jaya',
    slug: 'cv-berkah-jaya',
    dbSchema: 'tenant_berkah_jaya',
    plan: 'free',
    status: 'active',
  }).returning()
  console.log('Created tenant: CV Berkah Jaya')

  await db.insert(tenantMembers).values({
    userId: admin!.id,
    tenantId: tenant1.id,
    role: 'owner',
  })
  console.log('Assigned admin to PT Maju Jaya')

  const [client1] = await db.insert(clients).values({
    tenantId: tenant1.id,
    name: 'PT Sukses Mandiri',
    type: 'corporate',
    industry: 'Manufacturing',
    picName: 'Budi Santoso',
    picEmail: 'budi@succesmandiri.co.id',
    picPhone: '081234567890',
    status: 'active',
  }).returning()

  const [client2] = await db.insert(clients).values({
    tenantId: tenant1.id,
    name: 'CV Abadi Jaya',
    type: 'corporate',
    industry: 'Construction',
    picName: 'Andi Wijaya',
    picEmail: 'andi@abadijaya.co.id',
    picPhone: '081234567891',
    status: 'active',
  }).returning()

  const [_client3] = await db.insert(clients).values({
    tenantId: tenant1.id,
    name: 'UD Sejahtera',
    type: 'retail',
    industry: 'Retail',
    picName: 'Dewi Lestari',
    picEmail: 'dewi@sejahtera.co.id',
    picPhone: '081234567892',
    status: 'lead',
  }).returning()
  console.log('Created 3 clients')

  const [project1] = await db.insert(projects).values({
    tenantId: tenant1.id,
    projectCode: 'PRJ-001',
    name: 'Website Redesign',
    clientId: client1.id,
    projectManagerId: admin!.id,
    createdBy: admin!.id,
    status: 'in_progress',
    budget: '50000000.00',
    description: 'Complete website redesign for PT Sukses Mandiri',
  }).returning()

  const [project2] = await db.insert(projects).values({
    tenantId: tenant1.id,
    projectCode: 'PRJ-002',
    name: 'Mobile App Development',
    clientId: client2.id,
    projectManagerId: admin!.id,
    createdBy: admin!.id,
    status: 'planning',
    budget: '120000000.00',
    description: 'Native mobile app for CV Abadi Jaya',
  }).returning()
  console.log('Created 2 projects')

  const [col1] = await db.insert(kanbanColumns).values({
    projectId: project1.id,
    name: 'To Do',
    position: 0,
  }).returning()

  const [col2] = await db.insert(kanbanColumns).values({
    projectId: project1.id,
    name: 'In Progress',
    position: 1,
  }).returning()

  const [col3] = await db.insert(kanbanColumns).values({
    projectId: project2.id,
    name: 'To Do',
    position: 0,
  }).returning()

  const [col4] = await db.insert(kanbanColumns).values({
    projectId: project2.id,
    name: 'In Progress',
    position: 1,
  }).returning()

  await db.insert(tasks).values([
    {
      projectId: project1.id,
      columnId: col2.id,
      title: 'Design mockup homepage',
      assignedTo: admin!.id,
      createdBy: admin!.id,
      priority: 'high',
      position: 0,
    },
    {
      projectId: project1.id,
      columnId: col1.id,
      title: 'Setup CI/CD pipeline',
      assignedTo: admin!.id,
      createdBy: admin!.id,
      priority: 'medium',
      position: 1,
    },
    {
      projectId: project2.id,
      columnId: col3.id,
      title: 'Define API endpoints',
      assignedTo: admin!.id,
      createdBy: admin!.id,
      priority: 'high',
      position: 0,
    },
    {
      projectId: project2.id,
      columnId: col3.id,
      title: 'Create database schema',
      assignedTo: admin!.id,
      createdBy: admin!.id,
      priority: 'medium',
      position: 1,
    },
    {
      projectId: project2.id,
      columnId: col4.id,
      title: 'Setup project repository',
      assignedTo: admin!.id,
      createdBy: admin!.id,
      priority: 'low',
      position: 0,
    },
  ])
  console.log('Created 5 tasks')

  await db.insert(invoices).values([
    {
      tenantId: tenant1.id,
      invoiceNumber: 'INV-2026-001',
      clientId: client1.id,
      createdBy: admin!.id,
      issueDate: '2026-09-01',
      dueDate: '2026-09-30',
      status: 'sent',
      subtotal: '50000000.00',
      taxRate: '11.00',
      taxAmount: '5500000.00',
      grandTotal: '55500000.00',
    },
    {
      tenantId: tenant1.id,
      invoiceNumber: 'INV-2026-002',
      clientId: client2.id,
      createdBy: admin!.id,
      issueDate: '2026-09-05',
      dueDate: '2026-10-05',
      status: 'draft',
      subtotal: '30000000.00',
      taxRate: '11.00',
      taxAmount: '3300000.00',
      grandTotal: '33300000.00',
    },
    {
      tenantId: tenant1.id,
      invoiceNumber: 'INV-2026-003',
      clientId: client1.id,
      createdBy: admin!.id,
      issueDate: '2026-09-10',
      dueDate: '2026-10-10',
      status: 'paid',
      subtotal: '25000000.00',
      taxRate: '11.00',
      taxAmount: '2750000.00',
      grandTotal: '27750000.00',
      amountPaid: '27750000.00',
    },
  ])
  console.log('Created 3 invoices')

  await db.insert(catalogItems).values([
    {
      tenantId: tenant1.id,
      itemCode: 'SVC-001',
      name: 'Web Design Service',
      type: 'service',
      description: 'Professional website design and development',
      price: '15000000.00',
      unit: 'project',
    },
    {
      tenantId: tenant1.id,
      itemCode: 'SVC-002',
      name: 'Mobile App Development',
      type: 'service',
      description: 'Custom mobile application development',
      price: '50000000.00',
      unit: 'project',
    },
    {
      tenantId: tenant1.id,
      itemCode: 'PRD-001',
      name: 'Server Hosting',
      type: 'product',
      price: '500000.00',
      unit: 'month',
      isTrackInventory: false,
    },
    {
      tenantId: tenant1.id,
      itemCode: 'PRD-002',
      name: 'Domain Registration',
      type: 'product',
      price: '150000.00',
      unit: 'year',
      isTrackInventory: false,
    },
    {
      tenantId: tenant1.id,
      itemCode: 'SVC-003',
      name: 'IT Consulting',
      type: 'service',
      description: 'Technical consulting and architecture review',
      price: '2500000.00',
      unit: 'hour',
    },
  ])
  console.log('Created 5 catalog items')

  console.log('\n--- Seed Summary ---')
  console.log('Admin user: admin@hub.com (admin123)')
  console.log('Tenants: 2 (PT Maju Jaya, CV Berkah Jaya)')
  console.log('Clients: 3')
  console.log('Projects: 2')
  console.log('Tasks: 5')
  console.log('Invoices: 3')
  console.log('Catalog items: 5')
  console.log('Done!')
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
