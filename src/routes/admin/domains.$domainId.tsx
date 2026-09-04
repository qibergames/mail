import { createFileRoute } from '@tanstack/react-router'
import { DomainDetails } from '@/components/domain-details'

export const Route = createFileRoute('/admin/domains/$domainId')({
  component: () => <DomainDetails domainId={Route.useParams().domainId} />,
})
