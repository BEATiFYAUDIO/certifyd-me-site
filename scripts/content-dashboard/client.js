function markGenerating(form) {
  form.classList.add('is-generating');
  form.setAttribute('aria-busy', 'true');
  const progress = form.querySelector('.generation-progress');
  if (progress) progress.hidden = false;
  const submitters = form.querySelectorAll('button[type="submit"]');
  for (const button of submitters) {
    button.dataset.originalLabel = button.textContent || '';
    button.textContent = 'Generating…';
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (!form.matches('[data-generating-form]')) return;
  markGenerating(form);
});

document.addEventListener('click', async (event) => {
  const button = event.target;
  if (!(button instanceof HTMLButtonElement)) return;
  const targetId = button.dataset.copyTarget;
  const downloadId = button.dataset.downloadTarget;
  if (downloadId) {
    const source = document.getElementById(downloadId);
    if (!(source instanceof HTMLTextAreaElement)) return;
    const blob = new Blob([source.value], { type: downloadId.endsWith('-html') ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = button.dataset.downloadName || 'export.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return;
  }
  if (!targetId) return;
  const target = document.getElementById(targetId);
  if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return;
  await navigator.clipboard.writeText(target.value);
  const original = button.textContent || 'Copy';
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = original; }, 1200);
});

function updateDestinationPreview(form) {
  const preview = form.querySelector('[data-selected-destinations]');
  if (!preview) return;
  const selected = [...form.querySelectorAll('input[name="destinations"]:checked')].map((input) => input.closest('label')?.querySelector('strong')?.textContent || input.value);
  preview.textContent = selected.join(', ') || 'None';
}
document.addEventListener('change', (event) => {
  const form = event.target?.closest?.('[data-publish-everywhere]');
  if (form) updateDestinationPreview(form);
});
document.querySelectorAll('[data-publish-everywhere]').forEach(updateDestinationPreview);
