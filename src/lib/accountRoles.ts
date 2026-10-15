import type { Profile } from '@/types/database'

export const roleChoiceKey = (userId: string) => `ml-role-choice:${userId}`

export function canChooseFunction(profile: Profile | null): boolean {
  return !!profile?.operator_manager_access && profile.is_active && !profile.deleted_at &&
    (profile.role === 'operator' || profile.role === 'manager')
}

export function roleChoiceState(profile: Profile | null) {
  return { roleChoiceRequired: canChooseFunction(profile) && sessionStorage.getItem(roleChoiceKey(profile!.id)) !== profile!.role }
}
