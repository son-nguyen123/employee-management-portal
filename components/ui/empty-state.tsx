'use client'

import React from 'react'
import { Card } from './card'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className = '' }, ref) => (
    <Card
      ref={ref}
      variant="ghost"
      className={`flex flex-col items-center justify-center py-12 px-4 ${className}`}
    >
      {icon && (
        <div className="mb-4 text-4xl opacity-50">{icon}</div>
      )}
      <h3 className="font-semibold text-lg mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </Card>
  )
)
EmptyState.displayName = 'EmptyState'

export { EmptyState }
