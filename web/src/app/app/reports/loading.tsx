import { SkeletonCard, SkeletonHead } from '@/components/skeleton'

export default function ReportsLoading() {
  return (
    <>
      <SkeletonHead />
      <SkeletonCard title="Settled epochs" rows={3} />
    </>
  )
}
