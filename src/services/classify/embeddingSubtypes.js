// Complete visual descriptions. Each pair describes the same subtype; digital images are not called photographs.
export const EMBEDDING_RULES_VERSION = 'primary-subject-v3';
export const EMBEDDING_SUBTYPES = {
  "social_activities": [
    [
      "group-photo",
      "A group portrait of several people posing together.",
      "Several people standing or sitting together and facing the camera for a group photo."
    ],
    [
      "gathering",
      "People socializing together at a party, family meal or celebration.",
      "A social gathering with people interacting around a table or at a celebration."
    ],
    [
      "meeting",
      "People seated together for a meeting or conference.",
      "Meeting participants listening to a speaker or discussing around a table."
    ]
  ],
  "single_person": [
    ["environment-portrait", "A portrait focused on one person posing outdoors, with scenery behind them.", "A person is the main subject of an outdoor portrait, with their face and body prominent against a park, landscape or building background."],
    [
      "portrait",
      "A portrait of one person, with their face or body as the main subject.",
      "One person posing for a headshot, half-body or full-body portrait."
    ],
    [
      "selfie",
      "A selfie showing one person looking into the camera.",
      "A close-up self-portrait of a single person."
    ]
  ],
  "kids": [
    [
      "baby",
      "A real baby or toddler is the main subject of the photo.",
      "A close-up portrait of an infant or toddler."
    ],
    [
      "child",
      "A real young child playing or posing is the main subject.",
      "A photo focused on a child in everyday life."
    ]
  ],
  "pets": [
    [
      "cat",
      "A photo focused on a pet cat.",
      "A domestic cat resting, playing or looking at the camera."
    ],
    [
      "dog",
      "A photo focused on a pet dog.",
      "A domestic dog resting, playing or looking at the camera."
    ],
    [
      "other-pet",
      "A pet bird, rabbit or hamster is the main subject.",
      "A small companion animal photographed close up."
    ]
  ],
  "foods": [
    [
      "meal",
      "Prepared food served on a plate or in a bowl.",
      "A close-up of cooked dishes or a meal ready to eat."
    ],
    [
      "dessert",
      "A cake, pastry, sweet snack or dessert.",
      "A close-up food photo of baked sweets or a dessert."
    ],
    [
      "fruit",
      "Fresh fruit or vegetables presented as food.",
      "Edible fruit or vegetables arranged on a table or in a basket."
    ],
    [
      "drink",
      "A drink served in a cup, glass or bottle.",
      "A close-up of a beverage ready to drink."
    ]
  ],
  "travel_scenery": [
    [
      "mountain",
      "A wide scenic landscape focused on mountains, valleys and the sky.",
      "Natural scenery showing hills or mountains stretching into the distance."
    ],
    [
      "water",
      "An expansive view of a lake, river or coast where the water and surrounding landscape are the main subject.",
      "A wide scenic view across water toward the opposite shore and sky."
    ],
    [
      "park",
      "A wide park landscape focused on a lake, green trees and plants along the shore.",
      "Scenery of a pond or lake surrounded by greenery, with trees and sky in the background."
    ],
    [
      "countryside",
      "A wide landscape of a forest, fields or countryside.",
      "An outdoor scenic view dominated by woodland, grassland or a public park, with any people appearing as small distant figures."
    ]
  ],
  "screenshot": [
    [
      "phone",
      "A digital screen capture of a mobile app, chat or game interface.",
      "A phone screenshot containing interface controls, icons and messages."
    ],
    [
      "computer",
      "A digital screen capture of desktop software, a website or a game.",
      "A computer screenshot showing windows, menus or a webpage."
    ]
  ],
  "idcard": [
    [
      "document",
      "A close-up photo of an identity card or passport.",
      "An official identification document with a portrait and personal details."
    ],
    [
      "id-portrait",
      "A formal front-facing identification portrait against a plain background.",
      "A passport-style headshot with a centered face and plain background."
    ]
  ],
  "qrcode": [
    [
      "code",
      "A square QR code with a grid of small black and white modules.",
      "A close-up of a QR code with three large square finder patterns."
    ]
  ],
  "electronics": [
    [
      "network",
      "A network equipment cabinet containing servers, switches, routers and cables.",
      "A rack of network switches and server equipment connected by cables."
    ],
    [
      "computer",
      "A computer or laptop is the main subject of the photo.",
      "A desktop computer, monitor, keyboard or notebook computer photographed as equipment."
    ],
    [
      "phone",
      "A physical mobile phone or tablet device photographed as an object.",
      "A smartphone or tablet showing its screen, body or camera hardware."
    ],
    [
      "camera",
      "A camera, lens or photographic equipment photographed as objects.",
      "A close-up of a photographic camera and its lens."
    ],
    [
      "circuit",
      "An electronic circuit board with chips, wires and components.",
      "A close-up of a printed circuit board containing electronic components."
    ]
  ],
  "night_scene": [
    [
      "city-night",
      "An outdoor city scene at night, illuminated by streetlights and building lights.",
      "Dark nighttime streets and buildings lit by artificial lights."
    ],
    [
      "night-sky",
      "A dark night sky with stars or the moon above a landscape.",
      "An outdoor landscape photographed at night under a dark sky."
    ]
  ],
  "architecture": [
    [
      "building",
      "A building exterior or facade is the main subject of the photo.",
      "A close view emphasizing the design and structure of a building."
    ],
    [
      "interior",
      "An interior room showing its layout, walls, ceiling and architectural design.",
      "An indoor space photographed to show the room and its interior design."
    ],
    [
      "bridge",
      "A bridge or elevated structure is the main subject of the photo.",
      "A view emphasizing the structure and construction of a bridge."
    ]
  ],
  "plants": [
    [
      "flower",
      "A close-up of flowers or blossoms on a plant.",
      "Individual flowers or a flowering plant photographed in detail."
    ],
    [
      "potted",
      "A potted houseplant is the main subject of the photo.",
      "A close view of a living plant growing in a pot."
    ],
    [
      "tree",
      "An individual tree or shrub photographed as the main subject.",
      "A close view emphasizing the trunk, branches or shape of a tree."
    ],
    [
      "leaves",
      "A close-up of plant leaves showing their shape and texture.",
      "Detailed foliage or individual leaves filling the photo."
    ]
  ],
  "vehicles": [
    [
      "car",
      "A car, bus or truck is the main subject of the photo.",
      "A road vehicle photographed to show its body and wheels."
    ],
    [
      "bike",
      "A bicycle or motorcycle is the main subject of the photo.",
      "A two-wheeled vehicle photographed to show its frame and wheels."
    ],
    [
      "train",
      "A railway train is the main subject of the photo.",
      "A locomotive or train carriages on railway tracks."
    ],
    [
      "boat",
      "A boat or ship is the main subject of the photo.",
      "A watercraft photographed to show its hull and deck."
    ],
    [
      "aircraft",
      "An airplane or helicopter is the main subject of the photo.",
      "An aircraft photographed to show its wings or rotor and fuselage."
    ]
  ],
  "sports": [
    [
      "exercise",
      "A person running, lifting weights or performing a fitness exercise.",
      "An athlete visibly exercising, with their body engaged in a physical movement."
    ],
    [
      "ball-game",
      "Players actively playing a ball sport on a court or field.",
      "Athletes competing with a ball during a sports match."
    ],
    [
      "cycling",
      "A cyclist riding a bicycle, with hands on the handlebars and feet on the pedals.",
      "A person actively pedaling a bicycle during a cycling activity."
    ]
  ],
  "fashion": [
    [
      "outfit",
      "A fashion photo emphasizing the clothing and outfit being worn.",
      "Clothes displayed to show their cut, style and outfit coordination."
    ],
    [
      "accessories",
      "Shoes, hats, jewelry or fashion accessories displayed close up.",
      "A close-up emphasizing the design of footwear or fashion accessories."
    ]
  ],
  "products": [
    [
      "merchandise",
      "A product display with merchandise arranged for sale.",
      "A catalog or advertising photo presenting a retail item and its appearance."
    ],
    [
      "packaging",
      "A close-up of retail product packaging, boxes or labeled containers.",
      "Packaged merchandise showing its box, label or wrapping."
    ]
  ],
  "documents": [
    [
      "page",
      "A document page primarily filled with printed or handwritten text.",
      "A close-up of a paper document, letter or notes."
    ],
    [
      "receipt",
      "A receipt, invoice or ticket showing printed transaction details.",
      "A close-up of a paper receipt, invoice or admission ticket."
    ],
    [
      "form",
      "A document laid out as a form, table or spreadsheet.",
      "A page containing rows, columns or labeled fields for information."
    ]
  ],
  "art": [
    [
      "painting",
      "A painting, drawing or calligraphy artwork is the main subject.",
      "A work of painted art or artistic calligraphy photographed for display."
    ],
    [
      "sculpture",
      "A sculpture or handmade artistic craft is the main subject.",
      "A three-dimensional artwork or decorative sculpture photographed close up."
    ],
    [
      "award",
      "A trophy, medal or award displayed on a base.",
      "An award trophy or commemorative medal photographed close up."
    ]
  ],
  "cartoon": [
    [
      "character",
      "An illustration showing drawn cartoon characters or comic panels.",
      "A cartoon or comic image with illustrated characters."
    ],
    [
      "meme",
      "A meme, reaction image or illustrated sticker.",
      "A digital emoji, cartoon sticker or humorous image with a caption."
    ]
  ],
  "other": [
    [
      "miscellaneous",
      "Miscellaneous image content outside the available categories.",
      "An image whose main subject does not fit a specific available category."
    ]
  ]
};
