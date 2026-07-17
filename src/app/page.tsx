export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "2.5rem" }}>🎲 5 Dice 🎲</h1>
      <p style={{ opacity: 0.75, maxWidth: "34rem" }}>
        Rebuilding the serverless multiplayer dice game on Next.js with a
        server-authoritative networking core. The game engine lives in{" "}
        <code>src/game-core</code>; the UI arrives in a later milestone.
      </p>
    </main>
  );
}
