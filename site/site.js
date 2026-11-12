const copyButton = document.getElementById("copy-command");
const command = document.getElementById("install-command");
const status = document.getElementById("copy-status");
copyButton.addEventListener("click", async () => {
  copyButton.disabled = true;
  try {
    if (!navigator.clipboard?.writeText)
      throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(command.textContent.trim());
    status.textContent = "命令已复制。打开“终端”，粘贴后按回车执行。";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(command);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent =
      "自动复制未成功，已选中命令。请按 Command + C 手动复制。";
  } finally {
    copyButton.disabled = false;
  }
});
