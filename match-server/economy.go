package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

type combatItemSpec struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Price     int    `json:"price"`
	Damage    int    `json:"damage,omitempty"`
	AmmoType  string `json:"ammoType,omitempty"`
	GrantAmmo int    `json:"grantAmmo,omitempty"`
	Slot      string `json:"slot,omitempty"`
}

type combatLoadout struct {
	Weapon           string         `json:"weapon"`
	Vest             string         `json:"vest,omitempty"`
	Helmet           string         `json:"helmet,omitempty"`
	Ammo             map[string]int `json:"ammo"`
	Items            map[string]int `json:"items"`
	VestDurability   int            `json:"vestDurability"`
	HelmetDurability int            `json:"helmetDurability"`
}

type purchaseResult struct {
	PlayerID string        `json:"playerId"`
	ItemID   string        `json:"itemId"`
	Quantity int           `json:"quantity"`
	Spent    int           `json:"spent"`
	Credits  int           `json:"credits"`
	Loadout  combatLoadout `json:"loadout"`
}

type fireResult struct {
	PlayerID      string    `json:"playerId"`
	WeaponID      string    `json:"weaponId"`
	AmmoType      string    `json:"ammoType"`
	AmmoRemaining int       `json:"ammoRemaining"`
	Hit           hitResult `json:"hit"`
}

type useResult struct {
	PlayerID string `json:"playerId"`
	ItemID   string `json:"itemId"`
	Health   int    `json:"health"`
	Remaining int   `json:"remaining"`
}

var combatCatalog = map[string]combatItemSpec{
	"weapon.basic_pistol": {ID: "weapon.basic_pistol", Kind: "weapon", Price: 0, Damage: 30, AmmoType: "pistol", GrantAmmo: 24, Slot: "weapon"},
	"weapon.smg":          {ID: "weapon.smg", Kind: "weapon", Price: 1200, Damage: 24, AmmoType: "smg", GrantAmmo: 60, Slot: "weapon"},
	"weapon.rifle":        {ID: "weapon.rifle", Kind: "weapon", Price: 1800, Damage: 40, AmmoType: "rifle", GrantAmmo: 60, Slot: "weapon"},
	"weapon.shotgun":      {ID: "weapon.shotgun", Kind: "weapon", Price: 1500, Damage: 80, AmmoType: "shell", GrantAmmo: 16, Slot: "weapon"},
	"weapon.sniper":       {ID: "weapon.sniper", Kind: "weapon", Price: 2200, Damage: 120, AmmoType: "sniper", GrantAmmo: 10, Slot: "weapon"},
	"armor.vest1":         {ID: "armor.vest1", Kind: "equipment", Price: 400, Slot: "vest"},
	"armor.helmet1":       {ID: "armor.helmet1", Kind: "equipment", Price: 300, Slot: "helmet"},
	"ammo.pistol":         {ID: "ammo.pistol", Kind: "ammo", Price: 80, AmmoType: "pistol", GrantAmmo: 24},
	"ammo.smg":            {ID: "ammo.smg", Kind: "ammo", Price: 100, AmmoType: "smg", GrantAmmo: 30},
	"ammo.rifle":          {ID: "ammo.rifle", Kind: "ammo", Price: 120, AmmoType: "rifle", GrantAmmo: 30},
	"ammo.shell":          {ID: "ammo.shell", Kind: "ammo", Price: 120, AmmoType: "shell", GrantAmmo: 8},
	"ammo.sniper":         {ID: "ammo.sniper", Kind: "ammo", Price: 150, AmmoType: "sniper", GrantAmmo: 5},
	"utility.medkit":      {ID: "utility.medkit", Kind: "consumable", Price: 200},
}

func starterCombatLoadout() combatLoadout {
	return combatLoadout{
		Weapon: "weapon.basic_pistol",
		Ammo: map[string]int{
			"pistol": combatCatalog["weapon.basic_pistol"].GrantAmmo,
		},
		Items: map[string]int{},
	}
}

func catalogResponse() string {
	items := make([]combatItemSpec, 0, len(combatCatalog))
	for _, spec := range combatCatalog {
		items = append(items, spec)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	body, _ := json.Marshal(items)
	return "CATALOG " + string(body)
}

func buyCombatItem(match *matchState, playerID, itemID string, quantity int) (purchaseResult, error) {
	match.mu.Lock()
	defer match.mu.Unlock()
	if match.Status != "active" {
		return purchaseResult{}, fmt.Errorf("match_not_active")
	}
	player := match.Players[playerID]
	if player == nil {
		return purchaseResult{}, fmt.Errorf("player_not_in_match")
	}
	if !player.Alive || player.Downed {
		return purchaseResult{}, fmt.Errorf("player_not_available")
	}
	itemID = strings.TrimSpace(itemID)
	spec, ok := combatCatalog[itemID]
	if !ok {
		return purchaseResult{}, fmt.Errorf("unknown_combat_item")
	}
	if quantity <= 0 || quantity > 10 {
		return purchaseResult{}, fmt.Errorf("invalid_quantity")
	}
	if spec.Kind == "weapon" || spec.Kind == "equipment" {
		quantity = 1
	}
	cost := spec.Price * quantity
	if player.Credits < cost {
		return purchaseResult{}, fmt.Errorf("insufficient_credits")
	}
	if player.Loadout.Ammo == nil {
		player.Loadout.Ammo = map[string]int{}
	}
	if player.Loadout.Items == nil {
		player.Loadout.Items = map[string]int{}
	}
	player.Credits -= cost

	switch spec.Kind {
	case "weapon":
		player.Loadout.Weapon = spec.ID
		player.Loadout.Ammo[spec.AmmoType] += spec.GrantAmmo
	case "equipment":
		switch spec.Slot {
		case "vest":
			player.Loadout.Vest = spec.ID
			player.Loadout.VestDurability = 100
		case "helmet":
			player.Loadout.Helmet = spec.ID
			player.Loadout.HelmetDurability = 100
		}
	case "ammo":
		player.Loadout.Ammo[spec.AmmoType] += spec.GrantAmmo * quantity
	case "consumable":
		player.Loadout.Items[spec.ID] += quantity
	}
	player.LastSeen = time.Now().UnixMilli()
	match.UpdatedAt = player.LastSeen
	return purchaseResult{PlayerID: playerID, ItemID: spec.ID, Quantity: quantity, Spent: cost, Credits: player.Credits, Loadout: player.Loadout}, nil
}

func fireWeapon(match *matchState, attackerID, targetID string) (fireResult, error) {
	match.mu.Lock()
	if match.Status != "active" {
		match.mu.Unlock()
		return fireResult{}, fmt.Errorf("match_not_active")
	}
	attacker := match.Players[attackerID]
	if attacker == nil {
		match.mu.Unlock()
		return fireResult{}, fmt.Errorf("player_not_in_match")
	}
	if !attacker.Alive {
		match.mu.Unlock()
		return fireResult{}, fmt.Errorf("attacker_dead")
	}
	if attacker.Downed {
		match.mu.Unlock()
		return fireResult{}, fmt.Errorf("attacker_downed")
	}
	weaponID := attacker.Loadout.Weapon
	if weaponID == "" {
		weaponID = "weapon.basic_pistol"
		attacker.Loadout.Weapon = weaponID
	}
	spec, ok := combatCatalog[weaponID]
	if !ok || spec.Kind != "weapon" {
		match.mu.Unlock()
		return fireResult{}, fmt.Errorf("invalid_weapon")
	}
	if attacker.Loadout.Ammo == nil || attacker.Loadout.Ammo[spec.AmmoType] <= 0 {
		match.mu.Unlock()
		return fireResult{}, fmt.Errorf("out_of_ammo")
	}
	attacker.Loadout.Ammo[spec.AmmoType]--
	remaining := attacker.Loadout.Ammo[spec.AmmoType]
	match.mu.Unlock()

	hit, err := applyHit(match, attackerID, targetID, spec.Damage)
	if err != nil {
		match.mu.Lock()
		if player := match.Players[attackerID]; player != nil {
			if player.Loadout.Ammo == nil {
				player.Loadout.Ammo = map[string]int{}
			}
			player.Loadout.Ammo[spec.AmmoType]++
			remaining = player.Loadout.Ammo[spec.AmmoType]
		}
		match.mu.Unlock()
		return fireResult{}, err
	}
	return fireResult{PlayerID: attackerID, WeaponID: weaponID, AmmoType: spec.AmmoType, AmmoRemaining: remaining, Hit: hit}, nil
}

func useCombatItem(match *matchState, playerID, itemID string) (useResult, error) {
	match.mu.Lock()
	defer match.mu.Unlock()
	if match.Status != "active" {
		return useResult{}, fmt.Errorf("match_not_active")
	}
	player := match.Players[playerID]
	if player == nil {
		return useResult{}, fmt.Errorf("player_not_in_match")
	}
	if !player.Alive || player.Downed {
		return useResult{}, fmt.Errorf("player_not_available")
	}
	if itemID != "utility.medkit" {
		return useResult{}, fmt.Errorf("item_not_usable")
	}
	if player.Loadout.Items == nil || player.Loadout.Items[itemID] <= 0 {
		return useResult{}, fmt.Errorf("item_not_owned")
	}
	if player.Health >= player.MaxHealth {
		return useResult{}, fmt.Errorf("health_full")
	}
	player.Loadout.Items[itemID]--
	player.Health += 50
	if player.Health > player.MaxHealth {
		player.Health = player.MaxHealth
	}
	player.LastSeen = time.Now().UnixMilli()
	match.UpdatedAt = player.LastSeen
	return useResult{PlayerID: playerID, ItemID: itemID, Health: player.Health, Remaining: player.Loadout.Items[itemID]}, nil
}

func applyArmorMitigationLocked(target *playerState, incoming int) int {
	if incoming <= 0 || target == nil || target.Loadout.VestDurability <= 0 || target.Loadout.Vest == "" {
		return incoming
	}
	prevented := incoming / 5
	if prevented < 1 {
		prevented = 1
	}
	if prevented > target.Loadout.VestDurability {
		prevented = target.Loadout.VestDurability
	}
	target.Loadout.VestDurability -= prevented
	return incoming - prevented
}

func awardKillCreditsLocked(player *playerState) {
	if player != nil {
		player.Credits += 200
	}
}

func awardRoundCreditsLocked(match *matchState, winner int) {
	for _, player := range match.Players {
		if player.Team == winner {
			player.Credits += 1000
		} else {
			player.Credits += 600
		}
	}
	if match.Score[winner] >= match.TargetRounds {
		go maybeReportMatchResult(match)
	}
}
