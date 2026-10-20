document.querySelector('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('button');
  button.disabled = true;
  try { await window.fanoosSetup.connect(document.querySelector('input').value.trim()); }
  catch (error) { document.querySelector('#error').textContent = error.message; button.disabled = false; }
});
