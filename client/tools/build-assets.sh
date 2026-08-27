#!/usr/bin/env bash
# Regenera client/public/{sfx,music,models} a partir dos packs baixados (fontes/licenças em public/CREDITS.md).
# Rode dentro da pasta que contém: kenney_*/ (zips extraídos), oga/ (OpenGameArt) e glb/ (Zombie Apocalypse Kit
# convertido de glTF com `gltf-transform copy`). Pós-processo já aplicado aos GLB commitados (não está aqui):
#  - Survival Kit: `gltf-transform copy` com colormap RGBA para embutir a textura;
#  - Nature Kit: metallicFactor=0 + paleta verde nos materiais (a exportação da Kenney sai ciano/metálica).
set -e
PUB=/Users/leonardoazevedo/Documents/dev/warzombie/client/public
S=$PUB/sfx; M=$PUB/music; MD=$PUB/models
rm -rf "$S" "$M" "$MD/nature" "$MD/characters" "$MD/zombies" "$MD/props"
mkdir -p "$S" "$M" "$MD/nature" "$MD/characters" "$MD/zombies" "$MD/props"
IMP=kenney_impact-sounds/Audio; RPG=kenney_rpg-audio/Audio; UI=kenney_interface-sounds/Audio
# conv <in> <out> [extra ffmpeg filters/opts...]
conv(){ in="$1"; out="$2"; shift 2; ffmpeg -hide_banner -loglevel error -y -i "$in" "$@" -ac 1 -ar 44100 -c:a libmp3lame -q:a 3 "$S/$out.mp3"; }
# ---- arma ----
# tiro + recarga: "Pistol, animations, sounds for GoDot" (OGA, CC0) em oga/pg/Pistol/Sounds
conv oga/pg/Pistol/Sounds/pistol_Gunshot.wav gun_shot -af "afade=t=out:st=0.55:d=0.25,alimiter=limit=0.95" -t 0.8
# gun_reload = mag_out + mag_in (450 ms) + cock_back (950 ms) + cock_forward (1200 ms) mixados (ver commit)
conv $RPG/metalClick.ogg gun_empty -af volume=1.2
# golpe de faca: whoosh sintetizado (ruído rosa filtrado com envelope), sem asset externo
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "anoisesrc=color=pink:d=0.32:r=44100:a=0.9" -af "bandpass=f=850:w=500,bandpass=f=850:w=700,afade=t=in:d=0.06,afade=t=out:st=0.14:d=0.18,volume=6,alimiter=limit=0.9" -ac 1 -c:a libmp3lame -q:a 3 "$S/knife_swing_1.mp3"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "anoisesrc=color=pink:d=0.3:r=44100:a=0.9:seed=7" -af "bandpass=f=1150:w=600,bandpass=f=1150:w=800,afade=t=in:d=0.05,afade=t=out:st=0.13:d=0.17,volume=6,alimiter=limit=0.9" -ac 1 -c:a libmp3lame -q:a 3 "$S/knife_swing_2.mp3"
conv $RPG/drawKnife1.ogg knife_draw
conv $RPG/bookOpen.ogg shop_open
conv $RPG/bookClose.ogg shop_close
# ---- zumbis ----
i=1; for n in 16 17 18 21 20; do conv oga/zombies/zombies/zombie-$n.wav zombie_growl_$i; i=$((i+1)); done
i=1; for n in 1 8 9 15; do conv oga/zombies/zombies/zombie-$n.wav zombie_attack_$i; i=$((i+1)); done
i=1; for n in 10 17 18 9; do conv oga/monster/Monster-Sounds-Volume-2/monster-$n.wav zombie_hurt_$i; i=$((i+1)); done
i=1; for n in Monster-2 Monster-3 Monster-1; do conv oga/monster/Monster-Sounds-Volume-2/$n.wav zombie_death_$i -af "asetrate=44100*0.85,aresample=44100"; i=$((i+1)); done
conv oga/zombies/zombies/zombie-17.wav boss_roar -af "asetrate=44100*0.6,aresample=44100,bass=g=6,volume=1.4"
# ---- jogador ----
conv oga/death_grunts.wav player_hurt_1 -ss 0.50 -t 1.4
conv oga/death_grunts.wav player_hurt_2 -ss 6.94 -t 0.45
conv oga/death_grunts.wav player_hurt_3 -ss 10.0 -t 2.3
conv oga/death_grunts.wav player_death -ss 3.96 -t 2.15
# ---- interação ----
conv $RPG/handleSmallLeather.ogg pickup_1
conv $RPG/handleSmallLeather2.ogg pickup_2
conv $RPG/handleCoins.ogg coins_1
conv $RPG/handleCoins2.ogg coins_2
conv $RPG/chop.ogg chop_1
conv $IMP/impactWood_medium_000.ogg chop_2
conv $IMP/impactWood_medium_001.ogg chop_3
ffmpeg -hide_banner -loglevel error -y -i $IMP/impactWood_heavy_000.ogg -i $RPG/creak1.ogg -filter_complex "[1]adelay=60|60,volume=0.8[c];[0][c]amix=inputs=2:duration=longest,volume=1.5" -ac 1 -ar 44100 -c:a libmp3lame -q:a 3 "$S/tree_break.mp3"
conv $IMP/impactMining_000.ogg mine_1
conv $IMP/impactMining_001.ogg mine_2
conv $IMP/impactMining_002.ogg mine_3
ffmpeg -hide_banner -loglevel error -y -i $IMP/impactPlate_heavy_000.ogg -i $IMP/impactMining_004.ogg -filter_complex "[1]adelay=40|40[c];[0][c]amix=inputs=2:duration=longest,volume=1.6" -ac 1 -ar 44100 -c:a libmp3lame -q:a 3 "$S/rock_break.mp3"
conv $IMP/impactWood_medium_003.ogg wall_place
conv $IMP/impactWood_heavy_002.ogg wall_break
conv $IMP/impactPunch_medium_000.ogg hit_1
conv $IMP/impactPunch_medium_001.ogg hit_2
conv $IMP/impactSoft_heavy_000.ogg hit_soft
for n in 0 1 2 3 4; do conv $IMP/footstep_carpet_00$n.ogg step_$((n+1)) -af "lowpass=f=1800,afade=t=in:d=0.008,afade=t=out:st=0.12:d=0.1,volume=0.6" -t 0.25; done
# ---- ui / waves ----
conv $UI/click_001.ogg ui_click
conv $UI/open_001.ogg ui_open
conv $UI/close_001.ogg ui_close
conv $UI/error_001.ogg ui_error
conv $UI/confirmation_001.ogg ui_confirm
conv $IMP/impactBell_heavy_000.ogg wave_bell -af "asetrate=44100*0.8,aresample=44100,volume=1.2"
conv $IMP/impactBell_heavy_001.ogg wave_clear -af volume=1.1
conv $UI/bong_001.ogg battery_on
# ---- música ----
ffmpeg -hide_banner -loglevel error -y -i oga/forest_ambience.mp3 -ac 2 -ar 44100 -c:a libmp3lame -q:a 3 "$M/calm.mp3"
ffmpeg -hide_banner -loglevel error -y -i oga/horror/horror_loop.mp3 -ac 2 -ar 44100 -c:a libmp3lame -q:a 3 "$M/tension.mp3"
# ---- modelos ----
NK="kenney_nature-kit/Models/GLTF format"; SK="kenney_survival-kit/Models/GLB format"
for n in tree_default tree_oak tree_detailed tree_pineDefaultA tree_pineRoundA tree_thin rock_largeA rock_largeC rock_largeE rock_smallA rock_smallC stone_smallA grass grass_large grass_leafs flower_redA flower_yellowA flower_purpleA mushroom_red mushroom_tanGroup stump_round log plant_bush plant_bushSmall; do cp "$NK/$n.glb" "$MD/nature/$n.glb"; done
for n in resource-stone resource-wood tree-log-small fence fence-fortified metal-panel-screws workbench tent campfire-pit signpost box barrel; do cp "$SK/$n.glb" "$MD/props/$n.glb"; done
for n in WaterTower Barrel TrafficCone_1 TrafficBarrier_1 Pallet Blood_1 Blood_2 Vehicle_Pickup CinderBlock Chest; do cp "glb/$n.glb" "$MD/props/zak_$(echo $n | tr A-Z a-z).glb"; done
mkdir -p "$MD/props/Textures"; cp "$SK/Textures/colormap.png" "$MD/props/Textures/"
for n in Shaun Matt Sam Lis; do cp "glb/Characters_$n.glb" "$MD/characters/$(echo $n | tr A-Z a-z).glb"; done
for n in Basic Chubby Ribcage; do cp "glb/Zombie_$n.glb" "$MD/zombies/$(echo $n | tr A-Z a-z).glb"; done
rm -f "$MD/characters/worker.glb" "$MD/nature/tree.glb" "$MD/nature/rock-medium.glb"
du -sh "$S" "$M" "$MD"; ls "$S" | wc -l
