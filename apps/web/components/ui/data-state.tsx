import type { ReactNode } from 'react';
export function LoadingState({ label = 'Loading operational data…' }: { label?: string }) {
  return <div className="stateCard skeletonPulse">{label}</div>;
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="stateCard errorState">
      <strong>Unable to load data</strong>
      <span>{message}</span>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="stateCard">
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </div>
  );
}
