/** A button that opens the header's login picker. */
export default function LoginPrompt({ label }: { label: string }) {
  return (
    <button className="btn primary" onClick={() => dispatchEvent(new Event('beam:login'))}>
      {label}
    </button>
  );
}
