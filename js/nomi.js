// Nomi per giocatori e NPC, generati da nomi.txt (il browser non può leggere file .txt aprendo
// l'app da file://). Per cambiare la lista modifica questo elenco.
(function (DnD) {
  'use strict';

  const NAMES = [
    "Aelthir Ventoquieto",
    "Brunna Forgiaruna",
    "Caelan Ombrachiara",
    "Dagna Martellonero",
    "Eryndor Fogliargento",
    "Fara Pietradolce",
    "Galdric Corvoscudo",
    "Halia Lunafonda",
    "Ivar Manoferma",
    "Jasira Fiammadoro",
    "Kaelen Ramaselva",
    "Liora Acquasvelta",
    "Mordekai Ceneregrigia",
    "Nessa Raggiodalba",
    "Orin Scintillapietra",
    "Pyria Cantoquieto",
    "Quorin Passolungo",
    "Runa Geloluce",
    "Seldan Viteantica",
    "Thalia Cuor di Quercia",
    "Uldren Ferrovento",
    "Vanya Stellacupa",
    "Wulfric Zannalesta",
    "Xandria Brumacupa",
    "Yorin Cielospezzato",
    "Zelka Occhiodambra",
    "Arven Manto di Corvo",
    "Brenna Lingua di Brace",
    "Cyran Dorsodrago",
    "Delya Sussurralba",
    "Edrik Torcianello",
    "Fynna Fogliarossa",
    "Garron Scudodilupo",
    "Helmi Runa d'Argento",
    "Isolde Passo di Neve",
    "Jorek Occhi di Rame",
    "Kethra Lamaquieta",
    "Luthien Fiordelvento",
    "Marek Dente di Pietra",
    "Nimue Velo di Luna",
    "Odran Cuore di Tuono",
    "Petra Scintillaferma",
    "Rhalia Artiglioverde",
    "Soren Sentierobuio",
    "Tavik Mano di Cenere",
    "Ursula Radiceforte",
    "Vaelis Ala di Zaffiro",
    "Wenna Campanella",
    "Xarek Fendinebbia",
    "Ylva Brinacupa",
    "Zorren Cacciastelle",
    "Asha Miralago",
    "Baldor Granitomuto",
    "Cirel Falcoquieto",
    "Dorrik Spaccamassi",
    "Elowen Fiore di Rovo",
    "Fenric Lama di Gelo",
    "Gwyneth Alba di Rame",
    "Hadran Scavatorre",
    "Ilyra Seta d'Ombra",
    "Jasper Vialuce",
    "Korrin Piede di Ferro",
    "Mirelle Nottechiara",
    "Nyras Sorgente Blu",
    "Oskara Scudodicorno",
    "Perrin Velocefoglia",
    "Quilla Brillapiuma",
    "Rovak Rocciafonda",
    "Sylwen Voci di Bruma",
    "Tiber Fulminelesto"
  ];

  // Estrae un nome a caso, preferendo quelli non ancora usati; se sono finiti, uno qualsiasi.
  function pickName(names, used, rng) {
    const taken = new Set(used.map((n) => n.toLowerCase()));
    const free = names.filter((n) => !taken.has(n.toLowerCase()));
    const pool = free.length ? free : names;
    return pool.length ? pool[rng(pool.length) - 1] : null;
  }

  DnD.nomi = { NAMES, pickName };
})(globalThis.DnD = globalThis.DnD || {});
