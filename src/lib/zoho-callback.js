// Imported first by main.js: if this page load is Zoho sending the sign-in popup back,
// pass the token on and stop the app from starting in the popup.
import { handleRedirect } from './zoho-auth.js';

handleRedirect();
