<?php
// seed.php - Seed database with 100% Vegetable data, categories, users & settings
require_once 'config.php';

try {
    $db = getDB();
    
    // Read schema.sql and execute
    $sql = file_get_contents('schema.sql');
    $statements = array_filter(array_map('trim', explode(';', $sql)));
    foreach ($statements as $stmt) {
        if (!empty($stmt)) {
            $db->exec($stmt);
        }
    }
    
    // 1. Seed Users (Shopkeeper + Customer)
    $passHash = password_hash('123456', PASSWORD_DEFAULT);
    
    // Check if shopkeeper exists
    $stmt = $db->prepare("SELECT id FROM users WHERE phone = ?");
    $stmt->execute(['9876543210']);
    if (!$stmt->fetch()) {
        $db->prepare("INSERT INTO users (name, phone, email, password, role, address) VALUES (?, ?, ?, ?, ?, ?)")
           ->execute(['GreenHarvest Owner', '9876543210', 'shop@greenharvest.com', $passHash, 'shopkeeper', 'Shop #12, Fresh Vegetable Market, Main Road']);
    }
    
    // Check if demo customer exists
    $stmt = $db->prepare("SELECT id FROM users WHERE phone = ?");
    $stmt->execute(['9123456789']);
    if (!$stmt->fetch()) {
        $db->prepare("INSERT INTO users (name, phone, email, password, role, address) VALUES (?, ?, ?, ?, ?, ?)")
           ->execute(['Rahul Sharma', '9123456789', 'rahul@example.com', $passHash, 'customer', 'Flat 402, Sunshine Apartments, Green Park']);
    }

    // 2. Seed Shop Settings
    $db->exec("INSERT INTO shop_settings (id, shop_name, shop_status, shop_upi_id, min_order_amount, free_delivery_above, delivery_charge, estimated_delivery_time) 
               VALUES (1, 'GreenHarvest Veggies', 'OPEN', 'greenharvest@upi', 100.00, 300.00, 20.00, '20-30 mins')
               ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name)");

    // 3. Seed Vegetable Categories
    $categories = [
        ['name' => 'All Vegetables', 'icon' => '🥬', 'slug' => 'all-vegetables'],
        ['name' => 'Leafy Vegetables', 'icon' => '🍃', 'slug' => 'leafy-vegetables'],
        ['name' => 'Root Vegetables', 'icon' => '🥕', 'slug' => 'root-vegetables'],
        ['name' => 'Tubers', 'icon' => '🥔', 'slug' => 'tubers'],
        ['name' => 'Onions & Potatoes', 'icon' => '🧅', 'slug' => 'onions-potatoes'],
        ['name' => 'Tomatoes', 'icon' => '🍅', 'slug' => 'tomatoes'],
        ['name' => 'Green Vegetables', 'icon' => '🫑', 'slug' => 'green-vegetables'],
        ['name' => 'Gourds', 'icon' => '🥒', 'slug' => 'gourds'],
        ['name' => 'Brinjal', 'icon' => '🍆', 'slug' => 'brinjal'],
        ['name' => 'Ladies Finger', 'icon' => '🌾', 'slug' => 'ladies-finger'],
        ['name' => 'Beans & Peas', 'icon' => '🫛', 'slug' => 'beans-peas'],
        ['name' => 'Carrot & Beetroot', 'icon' => '🥕', 'slug' => 'carrot-beetroot'],
        ['name' => 'Cabbage & Cauliflower', 'icon' => '🥦', 'slug' => 'cabbage-cauliflower'],
        ['name' => 'Green Chilli, Ginger & Garlic', 'icon' => '🧄', 'slug' => 'chilli-ginger-garlic'],
        ['name' => 'Organic Vegetables', 'icon' => '🌿', 'slug' => 'organic-vegetables'],
        ['name' => 'Today\'s Offers', 'icon' => '🏷️', 'slug' => 'todays-offers']
    ];

    $catMap = [];
    foreach ($categories as $cat) {
        $stmt = $db->prepare("SELECT id FROM categories WHERE slug = ?");
        $stmt->execute([$cat['slug']]);
        $row = $stmt->fetch();
        if (!$row) {
            $db->prepare("INSERT INTO categories (name, icon, slug) VALUES (?, ?, ?)")
               ->execute([$cat['name'], $cat['icon'], $cat['slug']]);
            $catMap[$cat['slug']] = $db->lastInsertId();
        } else {
            $catMap[$cat['slug']] = $row['id'];
        }
    }

    // 4. Seed Products (100% VEGETABLES ONLY!)
    $products = [
        [
            'category' => 'tomatoes',
            'name' => 'Fresh Hybrid Tomato',
            'description' => 'Farm-fresh, juicy red hybrid tomatoes packed with rich antioxidants.',
            'price' => 40.00,
            'unit' => 'kg',
            'stock' => 50.0,
            'image' => 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 0, 'discount' => 10
        ],
        [
            'category' => 'onions-potatoes',
            'name' => 'Fresh Red Onion',
            'description' => 'Crisp, flavorful farm-direct red onions, essential for everyday cooking.',
            'price' => 40.00,
            'unit' => 'kg',
            'stock' => 75.0,
            'image' => 'https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 0, 'discount' => 0
        ],
        [
            'category' => 'onions-potatoes',
            'name' => 'New Crop Potato',
            'description' => 'Premium smooth-skin potatoes, perfect for curries, fries, and roasts.',
            'price' => 35.00,
            'unit' => 'kg',
            'stock' => 100.0,
            'image' => 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 0, 'discount' => 5
        ],
        [
            'category' => 'carrot-beetroot',
            'name' => 'Crunchy Orange Carrot',
            'description' => 'Sweet, vibrant crunchy carrots rich in Beta-Carotene.',
            'price' => 60.00,
            'unit' => 'kg',
            'stock' => 40.0,
            'image' => 'https://images.unsplash.com/photo-1598170845058-12ef4a457539?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 1, 'discount' => 0
        ],
        [
            'category' => 'leafy-vegetables',
            'name' => 'Fresh Green Spinach (Palak)',
            'description' => 'Tender, nutrient-rich spinach leaves harvested fresh early morning.',
            'price' => 30.00,
            'unit' => 'kg',
            'stock' => 30.0,
            'image' => 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 1, 'discount' => 0
        ],
        [
            'category' => 'leafy-vegetables',
            'name' => 'Fresh Coriander Bunch',
            'description' => 'Aromatic fresh green coriander leaves for garnishing and chutney.',
            'price' => 20.00,
            'unit' => 'pack',
            'stock' => 45.0,
            'image' => 'https://images.unsplash.com/photo-1588879460418-47201c107127?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 0, 'organic' => 0, 'discount' => 0
        ],
        [
            'category' => 'cabbage-cauliflower',
            'name' => 'Farm Fresh Cauliflower',
            'description' => 'Clean white dense cauliflower curd harvested from local organic fields.',
            'price' => 45.00,
            'unit' => 'kg',
            'stock' => 35.0,
            'image' => 'https://images.unsplash.com/photo-1568584711075-3d021a7c3ca3?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 0, 'discount' => 10
        ],
        [
            'category' => 'cabbage-cauliflower',
            'name' => 'Crispy Cabbage',
            'description' => 'Tightly packed crisp green cabbage heads, ideal for salads and stir-fries.',
            'price' => 35.00,
            'unit' => 'kg',
            'stock' => 40.0,
            'image' => 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 0, 'organic' => 0, 'discount' => 0
        ],
        [
            'category' => 'brinjal',
            'name' => 'Purple Brinjal (Eggplant)',
            'description' => 'Glossy purple brinjals, tender and perfect for Baingan Bharta or curries.',
            'price' => 50.00,
            'unit' => 'kg',
            'stock' => 25.0,
            'image' => 'https://images.unsplash.com/photo-1602497672288-fa081977759b?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 0, 'organic' => 0, 'discount' => 0
        ],
        [
            'category' => 'green-vegetables',
            'name' => 'Green Capsicum (Bell Pepper)',
            'description' => 'Crisp green bell peppers packed with Vitamin C.',
            'price' => 70.00,
            'unit' => 'kg',
            'stock' => 30.0,
            'image' => 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 1, 'discount' => 15
        ],
        [
            'category' => 'ladies-finger',
            'name' => 'Tender Lady Finger (Bhindi)',
            'description' => 'Fresh tender green bhindi, crisp and ready for cooking.',
            'price' => 55.00,
            'unit' => 'kg',
            'stock' => 35.0,
            'image' => 'https://images.unsplash.com/photo-1447175008436-08417092693d?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 0, 'discount' => 0
        ],
        [
            'category' => 'beans-peas',
            'name' => 'Fresh French Beans',
            'description' => 'Slender, crunchy French green beans loaded with fiber.',
            'price' => 65.00,
            'unit' => 'kg',
            'stock' => 25.0,
            'image' => 'https://images.unsplash.com/photo-1592417817098-8f3d6ef23a63?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 0, 'organic' => 1, 'discount' => 0
        ],
        [
            'category' => 'chilli-ginger-garlic',
            'name' => 'Spicy Green Chilli',
            'description' => 'Hot, aromatic green chillies to spice up your meals.',
            'price' => 40.00,
            'unit' => 'kg',
            'stock' => 20.0,
            'image' => 'https://images.unsplash.com/photo-1588252303782-cb80119abd6d?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 0, 'organic' => 0, 'discount' => 0
        ],
        [
            'category' => 'chilli-ginger-garlic',
            'name' => 'Fresh Ginger (Adrak)',
            'description' => 'Zesty ginger roots with rich essential oils for tea and cooking.',
            'price' => 120.00,
            'unit' => 'kg',
            'stock' => 15.0,
            'image' => 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 1, 'discount' => 0
        ],
        [
            'category' => 'chilli-ginger-garlic',
            'name' => 'Country Garlic (Lehsun)',
            'description' => 'Aromatic garlic cloves packed with authentic flavor.',
            'price' => 160.00,
            'unit' => 'kg',
            'stock' => 20.0,
            'image' => 'https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 0, 'discount' => 0
        ],
        [
            'category' => 'gourds',
            'name' => 'Fresh Green Cucumber (Kakdi)',
            'description' => 'Hydrating, crunchy green cucumbers for salads.',
            'price' => 30.00,
            'unit' => 'kg',
            'stock' => 40.0,
            'image' => 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 0, 'organic' => 0, 'discount' => 0
        ],
        [
            'category' => 'gourds',
            'name' => 'Tender Bottle Gourd (Lauki)',
            'description' => 'Light, digestible green bottle gourd, perfect for healthy juices and curries.',
            'price' => 40.00,
            'unit' => 'kg',
            'stock' => 30.0,
            'image' => 'https://images.unsplash.com/photo-1628773822503-930a7eaecf80?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 0, 'organic' => 1, 'discount' => 0
        ],
        [
            'category' => 'carrot-beetroot',
            'name' => 'Fresh Red Beetroot',
            'description' => 'Rich red beetroot packed with natural iron and minerals.',
            'price' => 45.00,
            'unit' => 'kg',
            'stock' => 25.0,
            'image' => 'https://images.unsplash.com/photo-1526470608268-f674ce90ebd4?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 0, 'organic' => 1, 'discount' => 0
        ],
        [
            'category' => 'organic-vegetables',
            'name' => 'Organic Broccoli',
            'description' => 'Certified 100% organic green broccoli florets high in vitamins.',
            'price' => 90.00,
            'unit' => 'kg',
            'stock' => 15.0,
            'image' => 'https://images.unsplash.com/photo-1459411621453-7b03977f4bfc?w=500&auto=format&fit=crop&q=80',
            'fresh' => 1, 'best' => 1, 'organic' => 1, 'discount' => 10
        ]
    ];

    foreach ($products as $p) {
        $catId = $catMap[$p['category']] ?? $catMap['all-vegetables'];
        $stmt = $db->prepare("SELECT id FROM products WHERE name = ?");
        $stmt->execute([$p['name']]);
        if (!$stmt->fetch()) {
            $db->prepare("INSERT INTO products (category_id, name, description, price, unit, available_stock, available_units, image_url, is_fresh_today, is_best_seller, is_organic, discount_percent)
                          VALUES (?, ?, ?, ?, ?, ?, '250g, 500g, 1kg, 2kg, 5kg', ?, ?, ?, ?, ?)")
               ->execute([$catId, $p['name'], $p['description'], $p['price'], $p['unit'], $p['stock'], $p['image'], $p['fresh'], $p['best'], $p['organic'], $p['discount']]);
        }
    }

    // 5. Seed Offers
    $offers = [
        ['title' => 'Fresh Morning Veggie Deal', 'code' => 'VEG10', 'type' => 'percentage', 'val' => 10.00, 'min' => 200.00],
        ['title' => 'Super Vegetable Saver', 'code' => 'GREEN50', 'type' => 'fixed', 'val' => 50.00, 'min' => 500.00],
        ['title' => 'Weekend Fresh Offer', 'code' => 'FRESH15', 'type' => 'percentage', 'val' => 15.00, 'min' => 350.00]
    ];

    foreach ($offers as $o) {
        $stmt = $db->prepare("SELECT id FROM offers WHERE code = ?");
        $stmt->execute([$o['code']]);
        if (!$stmt->fetch()) {
            $db->prepare("INSERT INTO offers (title, code, discount_type, discount_value, min_order) VALUES (?, ?, ?, ?, ?)")
               ->execute([$o['title'], $o['code'], $o['type'], $o['val'], $o['min']]);
        }
    }

    echo "Database successfully seeded with 100% Vegetable data!\n";
} catch (Exception $e) {
    echo "Seed Error: " . $e->getMessage() . "\n";
}
