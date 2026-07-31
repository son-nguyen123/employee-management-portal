'use client'

import React from 'react'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'default', size = 'md', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center gap-1.5 font-medium rounded-full transition-all duration-200'

    const sizeStyles = {
      sm: 'px-2 py-1 text-xs',
      md: 'px-3 py-1.5 text-sm',
      lg: 'px-4 py-2 text-base',
    }

    const variantStyles = {
      default: 'bg-secondary text-secondary-foreground',
      primary: 'bg-primary text-primary-foreground',
      success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-100',
      warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-100',
      destructive: 'bg-rose-500 text-white shadow-sm ring-2 ring-white dark:ring-slate-950',
      secondary: 'bg-muted text-muted-foreground',
      outline: 'border border-border bg-transparent text-foreground',
    }

    return (
      <span
        ref={ref}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
        {...props}
      />
    )
  }
)
Badge.displayName = 'Badge'

export { Badge }
