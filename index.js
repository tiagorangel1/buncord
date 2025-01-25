const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require("discord.js");
const fs = require("fs").promises;
const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const inviteLink = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}`;

async function executeCode(userCode, options = {}) {
  const {
    maxTime = 5000,
    maxMemory = 20 * 1024 * 1024,
    maxStorage = 5 * 1024 * 1024,
  } = options;

  const tempDir = path.join(
    "/tmp",
    `bun-run-${crypto.randomBytes(16).toString("hex")}`
  );

  try {
    await fs.mkdir(tempDir, { mode: 0o700 });

    const scriptPath = path.join(tempDir, "script.js");
    await fs.writeFile(scriptPath, userCode, { mode: 0o400 });

    const dockerCommand = [
      "docker",
      "run",
      "--rm",
      "--network",
      "none",
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      "--read-only",
      "--memory",
      "10m",
      "--memory-swap",
      "20m",
      "--user",
      "1000:1000",
      "--cpus",
      "0.5",
      "--ulimit",
      "nofile=64:64",
      "--ulimit",
      "nproc=64:64",
      "--tmpfs",
      `/tmp:rw,size=${maxStorage},noexec,nosuid`,
      "-v",
      `${tempDir}:/app:ro`,
      "oven/bun:alpine",
      "/bin/sh",
      "-c",
      `bun run /app/script.js`,
    ];

    return await new Promise((resolve, reject) => {
      const process = spawn(dockerCommand[0], dockerCommand.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeoutId = setTimeout(() => {
        process.kill("SIGKILL");
        reject(new Error("Execution timed out"));
      }, maxTime);

      let output = "";
      let errorOutput = "";

      process.stdout.on("data", (data) => {
        output += data.toString();
      });

      process.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      process.on("close", (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Execution failed: ${errorOutput}`));
        }
      });

      process.on("error", (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  } catch (error) {
    throw new Error(error.message);
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(console.error);
  }
}

const command = new SlashCommandBuilder()
  .setName("bun")
  .setDescription("Run code using Bun from a text input")
  .addStringOption((option) =>
    option.setName("code").setDescription("Code to execute").setRequired(true)
  )
  .toJSON();

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}\nInvite link: ${inviteLink}`);

  const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: [command],
    });
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName !== "bun") {
    return;
  }

  if (interaction.user.bot) {
    await interaction.reply({
      content: "❌ Bots are not allowed to use this command",
    });
    return;
  }

  if (!process.env.WHITELIST.split(",").includes(interaction.user.id)) {
    await interaction.reply({
      content:
        "❌ You are not whitelisted to use this command.\nPlease request permission by contacting me: https://tiagorangel.com/contact",
    });
    return;
  }

  let code = interaction.options.getString("code");
  let output, success;

  try {
    output = (await executeCode(code)).toString();
    success = true;
  } catch (error) {
    output = error?.message || error;
    success = false;
    console.log(output)
  }

  if (output.length > 1000) {
    output = output.slice(0, 1000) + "...";
  }

  if (code.length > 700) {
    code = code.slice(0, 1000) + "...";
  }

  try {
    const exampleEmbed = new EmbedBuilder()
      .setColor(success ? 0x57f287 : 0xed4245)
      .setTitle(success ? "✅ ‍ Code executed" : "❌ ‍ Code failed")
      .addFields({ name: "Code", value: `\`\`\`javascript\n${code}\n\`\`\`` })
      .addFields({
        name: success ? "Output" : "Error",
        value: `\`\`\`\n${output || " "}\n\`\`\``,
      });

    await interaction.reply({
      embeds: [exampleEmbed],
      content: ``,
    });
  } catch {
    await interaction.reply({
      content: "❌ An error occured",
    });
    return;
  }
});

client.login(process.env.BOT_TOKEN);