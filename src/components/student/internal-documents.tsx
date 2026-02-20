export function InternalDocuments({ student, currentUser, users, title, allowUpload }: any) {
  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-semibold">{title || 'Documents'}</h2>
      {allowUpload && <button className="mt-2 px-4 py-2 bg-blue-500 text-white rounded">Upload</button>}
    </div>
  );
}
