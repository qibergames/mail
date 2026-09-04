import { createFileRoute, redirect } from '@tanstack/react-router'
import { ToolsApp } from '@/components/tools-app'

const sections = ['contacts', 'templates', 'calendar', 'api-keys', 'webhooks', 'import-export'] as const
type ToolsSection = typeof sections[number]

export const Route = createFileRoute('/tools/$section')({
  beforeLoad: ({ params }) => { if (!sections.includes(params.section as ToolsSection)) throw redirect({ to: '/tools/$section', params: { section: 'contacts' } }) },
  component: () => <ToolsApp section={Route.useParams().section as ToolsSection} />,
})
