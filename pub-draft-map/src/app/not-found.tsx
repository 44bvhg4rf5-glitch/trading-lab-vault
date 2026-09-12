import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-stone-600 mt-2">That pub or beer isn&apos;t here.</p>
      <Link href="/" className="mt-4 underline">Back to the map</Link>
    </main>
  );
}
