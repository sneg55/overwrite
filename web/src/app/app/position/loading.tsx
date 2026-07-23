import { SkeletonCard, SkeletonHead } from '@/components/skeleton'

export default function PositionLoading() {
  return (
    <>
      <SkeletonHead />
      <SkeletonCard title="Deposits" rows={2} />
      <SkeletonCard title="Premium received" rows={2} />
    </>
  )
}
