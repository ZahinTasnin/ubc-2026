// TODO(Dev 1): wallet deposit, escrow/hedge state, receipt, claim refund.
export default async function CheckoutPage({ params }: { params: Promise<{ promoId: string }> }) {
  const { promoId } = await params;
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-bold">Checkout</h1>
      <p className="mt-2 text-sm text-neutral-500">Promotion: {promoId}</p>
      <p className="mt-4 text-neutral-600">Placeholder — not implemented.</p>
    </main>
  );
}
