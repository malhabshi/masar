import { PublicUploadForm } from './upload-form';

interface Props {
  params: { token: string };
}

export default function PublicUploadPage({ params }: Props) {
  return (
    <div className="min-h-screen bg-background flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">Document Upload</h1>
          <p className="text-muted-foreground text-sm">Please upload the required documents below.</p>
        </div>
        <PublicUploadForm token={params.token} />
      </div>
    </div>
  );
}
