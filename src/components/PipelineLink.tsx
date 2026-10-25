import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { pathFor } from '../app/routes';

export interface PipelineLinkProps {
  /** The merge request whose pipeline S-08 opens. */
  iid: number;
  className?: string;
  /** The status square and words, styled by the screen that shows them. */
  children: ReactNode;
}

/**
 * A pipeline status that opens S-08 of merge request `iid` (F-20.10): S-01 rows, the S-02 meta
 * line, the S-04 info header and the S-10 title bar. S-08's back link returns to where it was
 * opened from (M6 decision 4).
 */
export function PipelineLink({ iid, className, children }: PipelineLinkProps) {
  return (
    <Link className={className} to={pathFor({ screen: 'S-08', iid })}>
      {children}
    </Link>
  );
}
