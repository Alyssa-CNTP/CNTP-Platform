// Returns the correct home route for a given role.
// Called after login and on the root page redirect.
export function roleHome(role: string | null): string {
  switch (role) {
    case 'operator':   return '/operator'
    case 'admin':
    case 'supervisor':
    case 'management':
    default:           return '/home'
  }
}