import { api } from '../api';

/** The platform's name for "open the folder and select this file". */
export const revealLabel = () =>
  api.platform === 'darwin' ? 'Show in Finder' : api.platform === 'win32' ? 'Show in File Explorer' : 'Show in folder';
