export function IeltsSection({ student, currentUser }: any) {
  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-semibold">IELTS</h2>
      <p>Overall: {student?.ielts?.overall || 'N/A'}</p>
    </div>
  );
}
