export function ProfileCompletionProgress({ student, currentUser }: any) {
  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-semibold">Profile Completion</h2>
      <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
        <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: '0%' }}></div>
      </div>
    </div>
  );
}
