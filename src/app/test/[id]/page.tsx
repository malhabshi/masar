export default function TestPage({ params }: { params: { id: string } }) {
  return <h1>Test ID: {params.id}</h1>;
}
