export const MODE_PRESETS = Object.freeze({
  casual_solo: { maxPlayers: 1, minPlayers: 1, teams: 1, family: 'battle_royale' },
  casual_duo: { maxPlayers: 2, minPlayers: 2, teams: 1, family: 'battle_royale' },
  casual_squad: { maxPlayers: 4, minPlayers: 2, teams: 1, family: 'battle_royale' },
  ranked_solo: { maxPlayers: 1, minPlayers: 1, teams: 1, family: 'battle_royale' },
  ranked_duo: { maxPlayers: 2, minPlayers: 2, teams: 1, family: 'battle_royale' },
  ranked_squad: { maxPlayers: 4, minPlayers: 4, teams: 1, family: 'battle_royale' },

  clash_squad: { maxPlayers: 8, minPlayers: 2, teams: 2, family: 'clash_squad' },
  clash_squad_ranked: { maxPlayers: 8, minPlayers: 8, teams: 2, family: 'clash_squad' },

  lone_wolf: { maxPlayers: 2, minPlayers: 2, teams: 2, family: 'lone_wolf' },
  lone_wolf_strikeout: {
    maxPlayers: 8,
    minPlayers: 8,
    teams: 1,
    family: 'lone_wolf',
    temporary: true,
    note: 'Historical Strike Out format: eight players, three lives, rotating 1v1 fights.'
  },

  creation_workshop: {
    maxPlayers: 12,
    minPlayers: 2,
    teams: 2,
    maxTeams: 12,
    maxTeamSize: 6,
    family: 'creative',
    note: 'OB32 creation/editor room preset; team topology is configurable by the future protocol adapter.'
  },
  parkour: {
    maxPlayers: 12,
    minPlayers: 2,
    teams: 1,
    family: 'creative',
    temporary: true
  },

  pet_ludo: {
    maxPlayers: 4,
    minPlayers: 2,
    teams: 1,
    family: 'minigame',
    temporary: true
  },

  custom: { maxPlayers: 48, minPlayers: 1, teams: 2, family: 'custom' },
  training: { maxPlayers: 24, minPlayers: 1, teams: 1, family: 'training' }
});

export function getModePreset(mode) {
  return MODE_PRESETS[mode] || null;
}
