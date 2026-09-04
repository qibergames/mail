import { createFileRoute } from '@tanstack/react-router'
import { UserDetails } from '@/components/user-details'

export const Route = createFileRoute('/admin/accounts/$userId')({
  component: () => <UserDetails userId={Route.useParams().userId} />,
})
