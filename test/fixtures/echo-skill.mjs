// Fake "skill" for tests: echoes stdin, uppercased when input contains "shout".
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (input.includes("crash")) {
    console.error("boom");
    process.exit(3);
  }
  process.stdout.write(input.includes("shout") ? input.toUpperCase() : input);
});
