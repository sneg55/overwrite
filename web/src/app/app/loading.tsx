import { SkeletonCard, SkeletonHead, SkeletonTiles } from '@/components/skeleton'

export default function DashboardLoading() {
  return (
    <>
      <SkeletonHead />
      <SkeletonCard title="Epoch timeline" rows={2} />
      <SkeletonTiles count={2} />
      <SkeletonCard title="Written call" rows={5} />
    </>
  )
}
