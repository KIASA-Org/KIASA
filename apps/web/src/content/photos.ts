// GENERATED from the Lorem Picsum list: the stock photographs the site's pages use.
// Every one is an Unsplash photograph, free to use under the Unsplash License;
// author and source are kept beside it. Replace with KIASA's own photography in time.
import type { StaticImageData } from "next/image";
import aboveClouds from "@/assets/stock/above-clouds.jpg";
import airport from "@/assets/stock/airport.jpg";
import archBridge from "@/assets/stock/arch-bridge.jpg";
import bamboo from "@/assets/stock/bamboo.jpg";
import bridgeBelow from "@/assets/stock/bridge-below.jpg";
import bridgeCables from "@/assets/stock/bridge-cables.jpg";
import bridgeFog from "@/assets/stock/bridge-fog.jpg";
import bridgeNight from "@/assets/stock/bridge-night.jpg";
import brightRoom from "@/assets/stock/bright-room.jpg";
import cafeTable from "@/assets/stock/cafe-table.jpg";
import cafeWindows from "@/assets/stock/cafe-windows.jpg";
import cameraHands from "@/assets/stock/camera-hands.jpg";
import canopyBridge from "@/assets/stock/canopy-bridge.jpg";
import cityHaze from "@/assets/stock/city-haze.jpg";
import cityOverlook from "@/assets/stock/city-overlook.jpg";
import collegeLawn from "@/assets/stock/college-lawn.jpg";
import designTable from "@/assets/stock/design-table.jpg";
import deskAbove from "@/assets/stock/desk-above.jpg";
import deskFlatlay from "@/assets/stock/desk-flatlay.jpg";
import deskLaptop from "@/assets/stock/desk-laptop.jpg";
import deskWhite from "@/assets/stock/desk-white.jpg";
import deskWindow from "@/assets/stock/desk-window.jpg";
import desktopTablet from "@/assets/stock/desktop-tablet.jpg";
import duskCity from "@/assets/stock/dusk-city.jpg";
import escalators from "@/assets/stock/escalators.jpg";
import eveningStreet from "@/assets/stock/evening-street.jpg";
import fieldTree from "@/assets/stock/field-tree.jpg";
import fogForest from "@/assets/stock/fog-forest.jpg";
import forestCanopy from "@/assets/stock/forest-canopy.jpg";
import forestPath from "@/assets/stock/forest-path.jpg";
import glassRoof from "@/assets/stock/glass-roof.jpg";
import harbourCrane from "@/assets/stock/harbour-crane.jpg";
import hikerValley from "@/assets/stock/hiker-valley.jpg";
import industrialPlant from "@/assets/stock/industrial-plant.jpg";
import interchange from "@/assets/stock/interchange.jpg";
import keyboardMug from "@/assets/stock/keyboard-mug.jpg";
import lakeFigure from "@/assets/stock/lake-figure.jpg";
import laptopNotebook from "@/assets/stock/laptop-notebook.jpg";
import laptopTyping from "@/assets/stock/laptop-typing.jpg";
import leafDew from "@/assets/stock/leaf-dew.jpg";
import leafDrop from "@/assets/stock/leaf-drop.jpg";
import leafDrops from "@/assets/stock/leaf-drops.jpg";
import lightTrails from "@/assets/stock/light-trails.jpg";
import mistyValley from "@/assets/stock/misty-valley.jpg";
import mountainLake from "@/assets/stock/mountain-lake.jpg";
import nightTraffic from "@/assets/stock/night-traffic.jpg";
import openSea from "@/assets/stock/open-sea.jpg";
import orangeChair from "@/assets/stock/orange-chair.jpg";
import phoneHands from "@/assets/stock/phone-hands.jpg";
import powerLines from "@/assets/stock/power-lines.jpg";
import railTracks from "@/assets/stock/rail-tracks.jpg";
import rockyCoast from "@/assets/stock/rocky-coast.jpg";
import skylineBench from "@/assets/stock/skyline-bench.jpg";
import skylineDay from "@/assets/stock/skyline-day.jpg";
import stationFigure from "@/assets/stock/station-figure.jpg";
import stationHall from "@/assets/stock/station-hall.jpg";
import stationRoof from "@/assets/stock/station-roof.jpg";
import steelTower from "@/assets/stock/steel-tower.jpg";
import streetCrowd from "@/assets/stock/street-crowd.jpg";
import tabletHand from "@/assets/stock/tablet-hand.jpg";
import towersUp from "@/assets/stock/towers-up.jpg";
import trainCarriage from "@/assets/stock/train-carriage.jpg";
import typewriter from "@/assets/stock/typewriter.jpg";
import vaultedCeiling from "@/assets/stock/vaulted-ceiling.jpg";
import waterfall from "@/assets/stock/waterfall.jpg";
import wheat from "@/assets/stock/wheat.jpg";
import windRoad from "@/assets/stock/wind-road.jpg";
import workbench from "@/assets/stock/workbench.jpg";
import youngLeaves from "@/assets/stock/young-leaves.jpg";

export type PhotoKey =
  | "above-clouds"
  | "airport"
  | "arch-bridge"
  | "bamboo"
  | "bridge-below"
  | "bridge-cables"
  | "bridge-fog"
  | "bridge-night"
  | "bright-room"
  | "cafe-table"
  | "cafe-windows"
  | "camera-hands"
  | "canopy-bridge"
  | "city-haze"
  | "city-overlook"
  | "college-lawn"
  | "design-table"
  | "desk-above"
  | "desk-flatlay"
  | "desk-laptop"
  | "desk-white"
  | "desk-window"
  | "desktop-tablet"
  | "dusk-city"
  | "escalators"
  | "evening-street"
  | "field-tree"
  | "fog-forest"
  | "forest-canopy"
  | "forest-path"
  | "glass-roof"
  | "harbour-crane"
  | "hiker-valley"
  | "industrial-plant"
  | "interchange"
  | "keyboard-mug"
  | "lake-figure"
  | "laptop-notebook"
  | "laptop-typing"
  | "leaf-dew"
  | "leaf-drop"
  | "leaf-drops"
  | "light-trails"
  | "misty-valley"
  | "mountain-lake"
  | "night-traffic"
  | "open-sea"
  | "orange-chair"
  | "phone-hands"
  | "power-lines"
  | "rail-tracks"
  | "rocky-coast"
  | "skyline-bench"
  | "skyline-day"
  | "station-figure"
  | "station-hall"
  | "station-roof"
  | "steel-tower"
  | "street-crowd"
  | "tablet-hand"
  | "towers-up"
  | "train-carriage"
  | "typewriter"
  | "vaulted-ceiling"
  | "waterfall"
  | "wheat"
  | "wind-road"
  | "workbench"
  | "young-leaves";

export type Photo = { src: StaticImageData; alt: string; author: string; source: string };

export const photos: Record<PhotoKey, Photo> = {
  "above-clouds": { src: aboveClouds, alt: "A person sitting above a sea of clouds.", author: "Joshua Earle", source: "https://unsplash.com/photos/Dwheufds6kQ" },
  "airport": { src: airport, alt: "A passenger plane on the tarmac.", author: "José Martín", source: "https://unsplash.com/photos/Gauk-pFdvKk" },
  "arch-bridge": { src: archBridge, alt: "An arched bridge, in black and white.", author: "Matthew Wiebe", source: "https://unsplash.com/photos/HeVd38MWnw4" },
  "bamboo": { src: bamboo, alt: "A bamboo forest seen from below.", author: "Ståle Grut", source: "https://unsplash.com/photos/NUgw97CVdAk" },
  "bridge-below": { src: bridgeBelow, alt: "The underside of a bridge, seen from below.", author: "Calvin Chin", source: "https://unsplash.com/photos/LH9u2Us4T7A" },
  "bridge-cables": { src: bridgeCables, alt: "The cables of a suspension bridge against the sky.", author: "Vita Vilcina", source: "https://unsplash.com/photos/0G1r-Cg0zS8" },
  "bridge-fog": { src: bridgeFog, alt: "A red suspension bridge rising out of fog.", author: "Rob Bye", source: "https://unsplash.com/photos/bopC0sTGu-E" },
  "bridge-night": { src: bridgeNight, alt: "A bridge and a city skyline at night.", author: "Oleg Chursin", source: "https://unsplash.com/photos/IoCWq07GaG4" },
  "bright-room": { src: brightRoom, alt: "A bright room with a table and chairs.", author: "Breather", source: "https://unsplash.com/photos/DEdM9Vs6s8w" },
  "cafe-table": { src: cafeTable, alt: "A long wooden table in a café.", author: "Luke Chesser", source: "https://unsplash.com/photos/KR2mdHJ5qMg" },
  "cafe-windows": { src: cafeWindows, alt: "People in a café by tall windows, in black and white.", author: "Adam Przewoski", source: "https://unsplash.com/photos/umchkHwkdyM" },
  "camera-hands": { src: cameraHands, alt: "Someone holding a camera.", author: "Sergey Zolkin", source: "https://unsplash.com/photos/oDnfkgrxL64" },
  "canopy-bridge": { src: canopyBridge, alt: "A golden footbridge held up by two giant stone hands above a forested mountain ridge at sunrise.", author: "Supplied by KIASA", source: "" },
  "city-haze": { src: cityHaze, alt: "A city seen from above, in haze.", author: "Wojtek Witkowski", source: "https://unsplash.com/photos/GtxZbYMCiPY" },
  "city-overlook": { src: cityOverlook, alt: "A person sitting high above a city, looking out.", author: "Joshua Earle", source: "https://unsplash.com/photos/CND1MBxLA6M" },
  "college-lawn": { src: collegeLawn, alt: "A college building behind a striped lawn.", author: "Vadim Sherbakov", source: "https://unsplash.com/photos/d6ebY-faOO0" },
  "design-table": { src: designTable, alt: "Design work spread across a table.", author: "Jeff Sheldon", source: "https://unsplash.com/photos/9SyOKYrq-rE" },
  "desk-above": { src: deskAbove, alt: "A tidy desk seen from above, with a monitor, keyboard and speakers.", author: "Jeff Sheldon", source: "https://unsplash.com/photos/9dI3g8owHiI" },
  "desk-flatlay": { src: deskFlatlay, alt: "Notebooks, a phone and papers spread across a desk.", author: "Aleks Dorohovich", source: "https://unsplash.com/photos/nJdwUHmaY8A" },
  "desk-laptop": { src: deskLaptop, alt: "A laptop and a cup of coffee on a wooden desk.", author: "Alejandro Escamilla", source: "https://unsplash.com/photos/yC-Yzbqy7PY" },
  "desk-white": { src: deskWhite, alt: "A laptop, a book and a small speaker on a white desk.", author: "Nadir Balcikli", source: "https://unsplash.com/photos/wE9nUW7tMmk" },
  "desk-window": { src: deskWindow, alt: "A laptop on a desk by a bright window.", author: "Aleksi Tappura", source: "https://unsplash.com/photos/mCg0ZgD7BgU" },
  "desktop-tablet": { src: desktopTablet, alt: "A desktop computer, a keyboard and a tablet on a desk.", author: "William Iven", source: "https://unsplash.com/photos/GANqCr1BRTU" },
  "dusk-city": { src: duskCity, alt: "A person looking out over a city at dusk.", author: "Christopher Sardegna", source: "https://unsplash.com/photos/CMOa3H1SXG0" },
  "escalators": { src: escalators, alt: "Commuters on escalators in a busy station.", author: "Anna Dziubinska", source: "https://unsplash.com/photos/mVhd5QVlDWw" },
  "evening-street": { src: eveningStreet, alt: "People walking down a city street at sunset.", author: "David Marcu", source: "https://unsplash.com/photos/JZXAr--Qdf4" },
  "field-tree": { src: fieldTree, alt: "A lone tree in a golden field.", author: "Silvestri Matteo", source: "https://unsplash.com/photos/6-C0VRsagUw" },
  "fog-forest": { src: fogForest, alt: "A forest in fog.", author: "Jay Mantri", source: "https://unsplash.com/photos/TFyi0QOx08c" },
  "forest-canopy": { src: forestCanopy, alt: "Tall trees seen from below, their crowns meeting overhead.", author: "Kim Daniel", source: "https://unsplash.com/photos/JsqAqevX6lg" },
  "forest-path": { src: forestPath, alt: "A path through a green forest.", author: "Paul Jarvis", source: "https://unsplash.com/photos/9702xTENR-M" },
  "glass-roof": { src: glassRoof, alt: "A glass roof on a lattice of steel.", author: "Mika Ruusunen", source: "https://unsplash.com/photos/ypVM8PnygUo" },
  "harbour-crane": { src: harbourCrane, alt: "A floating crane on a barge in a harbour.", author: "Ksenia Kudelkina", source: "https://unsplash.com/photos/o5_LYQ44gsM" },
  "hiker-valley": { src: hikerValley, alt: "A hiker walking into a misty valley.", author: "Danka & Peter", source: "https://unsplash.com/photos/tvicgTdh7Fg" },
  "industrial-plant": { src: industrialPlant, alt: "Storage tanks and pipes at an industrial plant.", author: "André Robillard", source: "https://unsplash.com/photos/IUwLkxL49co" },
  "interchange": { src: interchange, alt: "A highway interchange seen from above.", author: "Steven Lewis", source: "https://unsplash.com/photos/dmHnXJ-5ilQ" },
  "keyboard-mug": { src: keyboardMug, alt: "A keyboard and a mug, in black and white.", author: "Rayi Christian Wicaksono", source: "https://unsplash.com/photos/6PF6DaiWz48" },
  "lake-figure": { src: lakeFigure, alt: "A person standing by a lake below mountains.", author: "Joshua Earle", source: "https://unsplash.com/photos/YxJ5AfKFgFE" },
  "laptop-notebook": { src: laptopNotebook, alt: "An open laptop beside a notebook and pen.", author: "Galymzhan Abdugalimov", source: "https://unsplash.com/photos/ICW6QYOcdlg" },
  "laptop-typing": { src: laptopTyping, alt: "Hands typing on a laptop at a wooden table.", author: "Alejandro Escamilla", source: "https://unsplash.com/photos/LNRyGwIJr5c" },
  "leaf-dew": { src: leafDew, alt: "A drop of dew hanging from a leaf.", author: "Shyamanta Baruah", source: "https://unsplash.com/photos/kxqvE41_07k" },
  "leaf-drop": { src: leafDrop, alt: "A drop of water on a bright green leaf.", author: "贝莉儿 NG", source: "https://unsplash.com/photos/C_-DQF-x-N0" },
  "leaf-drops": { src: leafDrops, alt: "Water drops on a green leaf.", author: "Buzo Jesús", source: "https://unsplash.com/photos/pHM4a_RZSLE" },
  "light-trails": { src: lightTrails, alt: "Light trails of traffic on a curving road at night.", author: "Caleb George", source: "https://unsplash.com/photos/URmkfvtK3Qw" },
  "misty-valley": { src: mistyValley, alt: "A misty valley with a stream.", author: "Paul Jarvis", source: "https://unsplash.com/photos/Cm7oKel-X2Q" },
  "mountain-lake": { src: mountainLake, alt: "Mountains reflected in a still lake.", author: "Alberto Restifo", source: "https://unsplash.com/photos/Ni4NgA64TFQ" },
  "night-traffic": { src: nightTraffic, alt: "City traffic at night, its lights blurred.", author: "Israel Sundseth", source: "https://unsplash.com/photos/BYu8ITUWMfc" },
  "open-sea": { src: openSea, alt: "The open sea.", author: "Matthew Kosloski", source: "https://unsplash.com/photos/BT_BUEwjeQg" },
  "orange-chair": { src: orangeChair, alt: "A desk with an orange chair.", author: "Jeff Sheldon", source: "https://unsplash.com/photos/JWiMShWiF14" },
  "phone-hands": { src: phoneHands, alt: "A hand holding a phone.", author: "Jay Wennington", source: "https://unsplash.com/photos/i8CYGnoerR0" },
  "power-lines": { src: powerLines, alt: "Railway tracks under a web of power cables.", author: "José Martín", source: "https://unsplash.com/photos/RxaN6Bbches" },
  "rail-tracks": { src: railTracks, alt: "Railway tracks running into the distance.", author: "Tiago Gerken", source: "https://unsplash.com/photos/vCqmY3bfqfo" },
  "rocky-coast": { src: rockyCoast, alt: "A rocky coast with pine trees.", author: "Paul Jarvis", source: "https://unsplash.com/photos/3MtiSMdnoCo" },
  "skyline-bench": { src: skylineBench, alt: "A person on a bench facing a city skyline.", author: "Namphuong Van", source: "https://unsplash.com/photos/hfIheOEJp9M" },
  "skyline-day": { src: skylineDay, alt: "A dense city skyline under a clear sky.", author: "Philipp Henzler", source: "https://unsplash.com/photos/dgE3lWVyDh8" },
  "station-figure": { src: stationFigure, alt: "A person silhouetted in a station.", author: "Thong Vo", source: "https://unsplash.com/photos/g28MgVK85bQ" },
  "station-hall": { src: stationHall, alt: "A busy station hall with people crossing it.", author: "Nicolai Berntsen", source: "https://unsplash.com/photos/2Qm47LI0W1c" },
  "station-roof": { src: stationRoof, alt: "A railway station's arched roof.", author: "Sylwia Bartyzel", source: "https://unsplash.com/photos/sfO5mHyObtM" },
  "steel-tower": { src: steelTower, alt: "A steel tower seen from below.", author: "Levi Saunders", source: "https://unsplash.com/photos/1nz-KjRdg-s" },
  "street-crowd": { src: streetCrowd, alt: "People on scooters and on foot in a crowded street.", author: "Steven Lewis", source: "https://unsplash.com/photos/r4He4Btlsro" },
  "tablet-hand": { src: tabletHand, alt: "A hand using a tablet.", author: "timothy muza", source: "https://unsplash.com/photos/6VjPmyMj5KM" },
  "towers-up": { src: towersUp, alt: "Skyscrapers seen from the street, looking up.", author: "davide ragusa", source: "https://unsplash.com/photos/slgtMF8EjYE" },
  "train-carriage": { src: trainCarriage, alt: "Inside a train carriage.", author: "Matthew Wiebe", source: "https://unsplash.com/photos/IisDI6liZEM" },
  "typewriter": { src: typewriter, alt: "A typewriter on a white desk.", author: "Florian Klauer", source: "https://unsplash.com/photos/mk7D-4UCfmg" },
  "vaulted-ceiling": { src: vaultedCeiling, alt: "White vaulted arches of a ceiling.", author: "Jeff Sheldon", source: "https://unsplash.com/photos/u3gES0SUsnI" },
  "waterfall": { src: waterfall, alt: "A waterfall pouring into a green valley.", author: "Jeff Sheldon", source: "https://unsplash.com/photos/SdSc4sWVMRU" },
  "wheat": { src: wheat, alt: "Wheat bending in the wind.", author: "Zugr", source: "https://unsplash.com/photos/kmF_Aq8gkp0" },
  "wind-road": { src: windRoad, alt: "A road curving past wind turbines.", author: "Andrea Boldizsar", source: "https://unsplash.com/photos/BwgKUh9tN84" },
  "workbench": { src: workbench, alt: "A workbench with leather, a compass and tools.", author: "Jeff Sheldon", source: "https://unsplash.com/photos/8z2Q6XWLYa4" },
  "young-leaves": { src: youngLeaves, alt: "Young green leaves.", author: "John French", source: "https://unsplash.com/photos/SNW4DWZEy8I" },
};

export const isPhoto = (key: string): key is PhotoKey => key in photos;
