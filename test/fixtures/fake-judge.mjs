// Fake judge for tests/demos: scores by marker words found in the graded response.
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  const response = prompt.split("<response>")[1] ?? "";
  if (response.includes("CRASH")) {
    console.error("judge down");
    process.exit(3);
  }
  if (response.includes("GARBAGE")) {
    process.stdout.write("I cannot decide.");
    return;
  }
  const score = response.includes("GOOD") ? 0.9 : response.includes("MID") ? 0.5 : 0.1;
  process.stdout.write(JSON.stringify({ score, reason: "fake" }));
});
