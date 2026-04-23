import { clone, readJsonFile, writeJsonFile } from '../store';

export interface ProfileRecord {
  name: string;
  agency: string;
  branch: string;
  license: string;
  whatsappConnected: boolean;
}

export interface SettingsRecord {
  tone: 'formal' | 'friendly' | 'casual';
  followUpCadenceHours: number;
  autoProfile: boolean;
  voiceTranscription: boolean;
  autoHandoffOnPricing: boolean;
  discloseAIIdentity: boolean;
}

interface SettingsState {
  profile: ProfileRecord;
  settings: SettingsRecord;
}

const DEFAULT_SETTINGS: SettingsState = {
  profile: {
    name: 'David Tan',
    agency: 'PropNex',
    branch: 'Tampines Branch',
    license: 'R058123G',
    whatsappConnected: true
  },
  settings: {
    tone: 'friendly',
    followUpCadenceHours: 24,
    autoProfile: true,
    voiceTranscription: true,
    autoHandoffOnPricing: true,
    discloseAIIdentity: true
  }
};

function readState() {
  return readJsonFile<SettingsState>('settings.json', DEFAULT_SETTINGS);
}

function writeState(state: SettingsState) {
  writeJsonFile('settings.json', state);
}

export function getProfile() {
  return clone(readState().profile);
}

export function updateProfile(updates: Partial<ProfileRecord>) {
  const state = readState();
  state.profile = { ...state.profile, ...updates };
  writeState(state);
  return clone(state.profile);
}

export function getSettings() {
  return clone(readState().settings);
}

export function updateSettings(updates: Partial<SettingsRecord>) {
  const state = readState();
  state.settings = { ...state.settings, ...updates };
  writeState(state);
  return clone(state.settings);
}
