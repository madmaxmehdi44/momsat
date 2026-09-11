'use client';

type Props = { visible: boolean };

/**
 * The browse page must render immediately. The catalog/player lifecycle is
 * responsible for real loading state; this decorative overlay is intentionally
 * disabled so it can never mask a slow catalog request or an autoplay attempt.
 */
export default function MomsatLaunchLoader(_props: Props) {
  return null;
}
