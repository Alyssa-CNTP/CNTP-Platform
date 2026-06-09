export const DEPARTMENT_META = {
  IT: {
    label: 'IT',
    description: 'Technology, infrastructure & development',
    color: 'bg-violet-500',
    roles: [
      { value: 'senior_developer', label: 'Senior Developer', isDefault: true },
      { value: 'developer',        label: 'Developer' },
      { value: 'admin',            label: 'Admin' },
    ],
    defaultRoute: '/dashboard',
  },
  Production: {
    label: 'Production',
    description: 'Operations, morning count, floor production',
    color: 'bg-orange-500',
    roles: [
      { value: 'supervisor',       label: 'Supervisor',       isDefault: true },
      { value: 'operator',         label: 'Operator' },
      { value: 'section_operator', label: 'Section Operator', requiresSection: true },
    ],
    sections: ['sieving','refining1','refining2','granule','blender','pasteuriser'],
    defaultRoute: '/production',
  },
  Quality: {
    label: 'Quality',
    description: 'QMS, lab results, sieving, pasteuriser, granule',
    color: 'bg-teal-500',
    roles: [
      { value: 'qms_manager',     label: 'QMS Manager',     isDefault: true },
      { value: 'lab_technician',  label: 'Lab Technician' },
      { value: 'quality_auditor', label: 'Quality Auditor' },
    ],
    defaultRoute: '/qms',
  },
  Sales: {
    label: 'Sales',
    description: 'Sales module & research engine',
    color: 'bg-blue-500',
    roles: [
      { value: 'sales_manager', label: 'Sales Manager', isDefault: true },
      { value: 'sales_rep',     label: 'Sales Rep' },
    ],
    defaultRoute: '/sales',
  },
  Marketing: {
    label: 'Marketing',
    description: 'Marketing module',
    color: 'bg-pink-500',
    roles: [
      { value: 'marketing_manager', label: 'Marketing Manager', isDefault: true },
      { value: 'content_creator',   label: 'Content Creator' },
    ],
    defaultRoute: '/marketing',
  },
  Management: {
    label: 'Management',
    description: 'Directors, analysts — read-only across platform',
    color: 'bg-stone-500',
    roles: [
      { value: 'management', label: 'Management', isDefault: true },
      { value: 'director',   label: 'Director' },
      { value: 'analyst',    label: 'Analyst' },
    ],
    defaultRoute: '/',
  },
} as const

export type Department = keyof typeof DEPARTMENT_META

export function getDefaultRoute(department: string): string {
  return DEPARTMENT_META[department as Department]?.defaultRoute ?? '/'
}
