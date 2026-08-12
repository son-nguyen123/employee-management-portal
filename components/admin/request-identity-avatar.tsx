'use client'

import type { LucideIcon } from 'lucide-react'
import { UserRound } from 'lucide-react'
import Image from 'next/image'
import { profileImageUrl } from '@/lib/utils/profileImage'

function initials(name: string) {
  return name.trim().split(/\s+/).slice(-2).map((part) => part[0]).join('').toLocaleUpperCase('vi') || 'NV'
}

export function RequestIdentityAvatar({
  name,
  photoURL,
  icon: Icon,
  iconColor,
  compact = false,
}: {
  name: string
  photoURL?: string
  icon: LucideIcon
  iconColor: string
  compact?: boolean
}) {
  return (
    <div className={`relative shrink-0 ${compact ? 'h-11 w-11' : 'h-14 w-14'}`}>
      <div className={`grid place-items-center overflow-hidden rounded-full bg-slate-900 font-black text-white shadow-sm ${compact ? 'h-11 w-11 text-xs' : 'h-14 w-14 text-sm'}`}>
        {photoURL
          ? <Image src={profileImageUrl(photoURL)} alt={`Ảnh đại diện của ${name}`} width={compact ? 44 : 56} height={compact ? 44 : 56} loading="eager" className="h-full w-full object-cover" />
          : name ? initials(name) : <UserRound className="h-5 w-5" />}
      </div>
      <span className={`absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full border-2 border-white text-white shadow-md dark:border-slate-900 ${compact ? 'h-5 w-5' : 'h-7 w-7'} ${iconColor}`}>
        <Icon className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
      </span>
    </div>
  )
}
