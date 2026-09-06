export const phone = window.AmadeusAndroid;

// External pages open in Android's browser and never replace the bundled app.
if (phone) {
  document.documentElement.classList.add('android-app');
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (link && /^https?:/.test(link.href)) {
      event.preventDefault();
      phone.openUrl(link.href);
    }
  });
}
