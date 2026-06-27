export const LoadingSkeleton = () => (
  <div className="space-y-4 p-6">
    {[...Array(3)].map((_, i) => (
      <div key={i} className="bg-gray-200 rounded-lg h-20 animate-pulse" />
    ))}
  </div>
);

export const MemberCardSkeleton = () => (
  <div className="bg-white rounded-lg shadow p-4 space-y-3">
    <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
    <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
    <div className="h-4 bg-gray-200 rounded animate-pulse w-1/2" />
    <div className="flex gap-2 pt-2">
      <div className="h-8 bg-gray-200 rounded animate-pulse flex-1" />
      <div className="h-8 bg-gray-200 rounded animate-pulse flex-1" />
    </div>
  </div>
);

export const TableRowSkeleton = () => (
  <tr>
    <td className="py-4 px-6"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
    <td className="py-4 px-6"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
    <td className="py-4 px-6"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
    <td className="py-4 px-6"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
  </tr>
);
