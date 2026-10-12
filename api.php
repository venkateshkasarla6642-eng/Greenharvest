<?php
// api.php - Master API Router for Customer and Shopkeeper
require_once 'config.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? $_POST['action'] ?? '';

$db = getDB();
$user = getCurrentUser();

// Auth & RBAC Helpers
function checkAuthUser() {
    global $user;
    if (!$user) {
        jsonResponse(['error' => 'Authentication required. Please sign in to continue.'], 401);
    }
    return $user;
}

function checkShopkeeperRole() {
    global $user;
    if (!$user) {
        jsonResponse(['error' => 'Authentication required. Please sign in as Shopkeeper.'], 401);
    }
    if ($user['role'] !== 'shopkeeper') {
        jsonResponse(['error' => 'Access Denied: Only Shopkeepers can perform this action.'], 403);
    }
    return $user;
}

function checkCustomerRole() {
    global $user;
    if (!$user) {
        jsonResponse(['error' => 'Authentication required. Please sign in as Customer.'], 401);
    }
    if ($user['role'] !== 'customer') {
        jsonResponse(['error' => 'Access Denied: Customer account required.'], 403);
    }
    return $user;
}

function formatUserData($u) {
    if (!$u) return null;
    return [
        'id' => intval($u['id']),
        'name' => $u['name'] ?? '',
        'phone' => $u['phone'] ?? '',
        'email' => $u['email'] ?? '',
        'profile_photo' => $u['profile_photo'] ?? null,
        'role' => $u['role'] ?? 'customer',
        'address' => $u['address'] ?? '',
        'house_no' => $u['house_no'] ?? '',
        'street' => $u['street'] ?? '',
        'city' => $u['city'] ?? '',
        'district' => $u['district'] ?? '',
        'state' => $u['state'] ?? '',
        'pincode' => $u['pincode'] ?? ''
    ];
}

switch ($action) {

    // --- AUTHENTICATION ---
    case 'login':
        $phone = trim($_POST['phone'] ?? '');
        $password = trim($_POST['password'] ?? '');
        $portalRole = trim($_POST['role'] ?? '');

        if (!$phone || !$password) {
            jsonResponse(['error' => 'Phone number and password are required'], 400);
        }

        $stmt = $db->prepare("SELECT * FROM users WHERE phone = ?");
        $stmt->execute([$phone]);
        $u = $stmt->fetch();

        if ($u && password_verify($password, $u['password'])) {
            if ($portalRole && $u['role'] !== $portalRole) {
                jsonResponse(['error' => "This account is registered as a " . ucfirst($u['role']) . ". Please sign in under the " . ucfirst($u['role']) . " tab."], 403);
            }
            $_SESSION['user_id'] = $u['id'];
            $_SESSION['role'] = $u['role'];
            jsonResponse(['success' => true, 'user' => formatUserData($u)]);
        } else {
            // Auto demo login helper if default demo credentials used
            if (($phone === '9123456789' || $phone === '9876543210') && $password === '123456') {
                $targetRole = ($phone === '9876543210') ? 'shopkeeper' : 'customer';
                if ($portalRole && $targetRole !== $portalRole) {
                    jsonResponse(['error' => "This demo account is for " . ucfirst($targetRole) . "."], 403);
                }
                $stmt = $db->prepare("SELECT * FROM users WHERE role = ? LIMIT 1");
                $stmt->execute([$targetRole]);
                $u = $stmt->fetch();
                if ($u) {
                    $_SESSION['user_id'] = $u['id'];
                    $_SESSION['role'] = $u['role'];
                    jsonResponse(['success' => true, 'user' => formatUserData($u)]);
                }
            }
            jsonResponse(['error' => 'Invalid phone number or password'], 401);
        }
        break;

    case 'register':
        $name = trim($_POST['name'] ?? '');
        $phone = trim($_POST['phone'] ?? '');
        $email = trim($_POST['email'] ?? '');
        $password = trim($_POST['password'] ?? '');
        $role = trim($_POST['role'] ?? 'customer');
        $address = trim($_POST['address'] ?? '');

        if (!$name || !$phone || !$password) {
            jsonResponse(['error' => 'Name, phone and password are required'], 400);
        }

        $stmt = $db->prepare("SELECT id FROM users WHERE phone = ?");
        $stmt->execute([$phone]);
        if ($stmt->fetch()) {
            jsonResponse(['error' => 'Phone number already registered'], 400);
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $db->prepare("INSERT INTO users (name, phone, email, password, role, address) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([$name, $phone, $email, $hash, $role, $address]);
        $newId = $db->lastInsertId();

        $_SESSION['user_id'] = $newId;
        $_SESSION['role'] = $role;

        $newU = $db->query("SELECT * FROM users WHERE id = " . intval($newId))->fetch();
        // If address provided, create initial default delivery address
        if ($address && $role === 'customer') {
            $stmtAddr = $db->prepare("INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, house_no, city, state, pincode, is_default) VALUES (?, 'Home', ?, ?, ?, 'Pune', 'Maharashtra', '411001', 1)");
            $stmtAddr->execute([$newId, $name, $phone, $address]);
        }

        jsonResponse(['success' => true, 'user' => formatUserData($newU)]);
        break;

    case 'logout':
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
        jsonResponse(['success' => true]);
        break;

    case 'get_current_user':
        jsonResponse(['user' => formatUserData($user)]);
        break;

    // --- PROFILE MANAGEMENT (CUSTOMER & SHOPKEEPER) ---
    case 'get_profile':
        $u = checkAuthUser();
        $profile = formatUserData($u);
        $extra = [];
        if ($u['role'] === 'shopkeeper') {
            $shop = $db->query("SELECT shop_name, shop_status, shop_upi_id, estimated_delivery_time FROM shop_settings WHERE id = 1")->fetch();
            $extra['shop_settings'] = $shop;
        }
        jsonResponse(['success' => true, 'profile' => $profile, 'extra' => $extra]);
        break;

    case 'update_profile':
        $u = checkAuthUser();
        $userId = $u['id'];
        $name = trim($_POST['name'] ?? '');
        $email = trim($_POST['email'] ?? '');
        $phone = trim($_POST['phone'] ?? '');

        if (!$name) {
            jsonResponse(['error' => 'Full name cannot be empty'], 400);
        }
        if ($phone && !preg_match('/^[0-9]{10}$/', $phone)) {
            jsonResponse(['error' => 'Please enter a valid 10-digit mobile number'], 400);
        }
        if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            jsonResponse(['error' => 'Please enter a valid email address'], 400);
        }

        if ($phone && $phone !== $u['phone']) {
            $chk = $db->prepare("SELECT id FROM users WHERE phone = ? AND id != ?");
            $chk->execute([$phone, $userId]);
            if ($chk->fetch()) {
                jsonResponse(['error' => 'Phone number already registered with another account'], 400);
            }
        }

        if ($u['role'] === 'customer') {
            $house_no = trim($_POST['house_no'] ?? '');
            $street = trim($_POST['street'] ?? '');
            $city = trim($_POST['city'] ?? '');
            $district = trim($_POST['district'] ?? '');
            $state = trim($_POST['state'] ?? '');
            $pincode = trim($_POST['pincode'] ?? '');

            if ($pincode && !preg_match('/^[0-9]{6}$/', $pincode)) {
                jsonResponse(['error' => 'PIN code must be a 6-digit number'], 400);
            }

            $addrParts = array_filter([$house_no, $street, $city, $district, $state, $pincode ? "PIN: $pincode" : null]);
            $fullAddress = trim($_POST['address'] ?? implode(', ', $addrParts));
            if (!$fullAddress) $fullAddress = implode(', ', $addrParts);

            $stmt = $db->prepare("UPDATE users SET name = ?, email = ?, phone = ?, house_no = ?, street = ?, city = ?, district = ?, state = ?, pincode = ?, address = ? WHERE id = ?");
            $stmt->execute([$name, $email, $phone ?: $u['phone'], $house_no, $street, $city, $district, $state, $pincode, $fullAddress, $userId]);

            // Sync with default delivery address
            $defStmt = $db->prepare("SELECT id FROM customer_addresses WHERE customer_id = ? AND is_default = 1");
            $defStmt->execute([$userId]);
            $existingDef = $defStmt->fetch();
            if ($existingDef) {
                $upAddr = $db->prepare("UPDATE customer_addresses SET recipient_name = ?, phone = ?, house_no = ?, street = ?, city = ?, district = ?, state = ?, pincode = ? WHERE id = ?");
                $upAddr->execute([$name, $phone ?: $u['phone'], $house_no, $street, $city ?: 'Pune', $district ?: 'Pune', $state ?: 'Maharashtra', $pincode ?: '411001', $existingDef['id']]);
            } else if ($fullAddress) {
                $insAddr = $db->prepare("INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, house_no, street, city, district, state, pincode, is_default) VALUES (?, 'Home', ?, ?, ?, ?, ?, ?, ?, ?, 1)");
                $insAddr->execute([$userId, $name, $phone ?: $u['phone'], $house_no, $street, $city ?: 'Pune', $district ?: 'Pune', $state ?: 'Maharashtra', $pincode ?: '411001']);
            }
        } else if ($u['role'] === 'shopkeeper') {
            $shop_name = trim($_POST['shop_name'] ?? '');
            $address = trim($_POST['address'] ?? '');

            $stmt = $db->prepare("UPDATE users SET name = ?, email = ?, phone = ?, address = ? WHERE id = ?");
            $stmt->execute([$name, $email, $phone ?: $u['phone'], $address, $userId]);

            if ($shop_name) {
                $stmtShop = $db->prepare("UPDATE shop_settings SET shop_name = ? WHERE id = 1");
                $stmtShop->execute([$shop_name]);
            }
        }

        $refreshed = getCurrentUser();
        jsonResponse([
            'success' => true,
            'message' => 'Profile details updated successfully',
            'user' => formatUserData($refreshed)
        ]);
        break;

    case 'upload_profile_photo':
        $u = checkAuthUser();
        $userId = $u['id'];

        if (!isset($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
            $errCode = $_FILES['photo']['error'] ?? 'NONE';
            jsonResponse(['error' => 'Photo upload failed (Code: ' . $errCode . '). Please select an image file.'], 400);
        }

        $file = $_FILES['photo'];
        $maxBytes = 5 * 1024 * 1024; // 5MB
        if ($file['size'] > $maxBytes) {
            jsonResponse(['error' => 'Image size exceeds maximum limit of 5MB.'], 400);
        }

        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);

        $allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        if (!in_array($mime, $allowedMimes)) {
            jsonResponse(['error' => 'Unsupported image type. Only JPEG, PNG, and WebP are allowed.'], 400);
        }

        $ext = match ($mime) {
            'image/jpeg', 'image/jpg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            default => 'jpg'
        };

        $uploadDir = __DIR__ . '/uploads/profiles/';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0777, true);
        }

        $filename = 'user_' . $userId . '_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
        $destPath = $uploadDir . $filename;

        if (!move_uploaded_file($file['tmp_name'], $destPath)) {
            jsonResponse(['error' => 'Failed to store uploaded image on server.'], 500);
        }

        $photoRelPath = 'uploads/profiles/' . $filename;

        // Clean up old local profile photo if applicable
        if (!empty($u['profile_photo']) && str_starts_with($u['profile_photo'], 'uploads/profiles/')) {
            $oldPath = __DIR__ . '/' . $u['profile_photo'];
            if (file_exists($oldPath)) {
                @unlink($oldPath);
            }
        }

        $stmt = $db->prepare("UPDATE users SET profile_photo = ? WHERE id = ?");
        $stmt->execute([$photoRelPath, $userId]);

        $refreshed = getCurrentUser();
        jsonResponse([
            'success' => true,
            'message' => 'Profile photo uploaded and saved successfully!',
            'photo_url' => $photoRelPath,
            'user' => formatUserData($refreshed)
        ]);
        break;

    // --- MULTIPLE DELIVERY ADDRESSES (CUSTOMER) ---
    case 'get_addresses':
        $u = checkCustomerRole();
        $stmt = $db->prepare("SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, id DESC");
        $stmt->execute([$u['id']]);
        $addrs = $stmt->fetchAll();
        jsonResponse(['success' => true, 'addresses' => $addrs]);
        break;

    case 'add_address':
        $u = checkCustomerRole();
        $userId = $u['id'];
        $label = trim($_POST['label'] ?? 'Home');
        $recipient = trim($_POST['recipient_name'] ?? $u['name']);
        $phone = trim($_POST['phone'] ?? $u['phone']);
        $house_no = trim($_POST['house_no'] ?? '');
        $street = trim($_POST['street'] ?? '');
        $city = trim($_POST['city'] ?? '');
        $district = trim($_POST['district'] ?? '');
        $state = trim($_POST['state'] ?? 'Maharashtra');
        $pincode = trim($_POST['pincode'] ?? '');
        $instructions = trim($_POST['delivery_instructions'] ?? '');
        $is_default = (!empty($_POST['is_default']) && ($_POST['is_default'] == '1' || $_POST['is_default'] === 'true')) ? 1 : 0;

        if (!$recipient || !$phone || !$city || !$pincode) {
            jsonResponse(['error' => 'Recipient name, phone, city, and PIN code are required'], 400);
        }
        if (!preg_match('/^[0-9]{6}$/', $pincode)) {
            jsonResponse(['error' => 'PIN code must be a 6-digit number'], 400);
        }

        // If first address for customer, auto-make default
        $cnt = $db->prepare("SELECT COUNT(*) FROM customer_addresses WHERE customer_id = ?");
        $cnt->execute([$userId]);
        if ($cnt->fetchColumn() == 0) {
            $is_default = 1;
        }

        if ($is_default) {
            $db->prepare("UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?")->execute([$userId]);
        }

        $stmt = $db->prepare("INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, house_no, street, city, district, state, pincode, delivery_instructions, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$userId, $label, $recipient, $phone, $house_no, $street, $city, $district, $state, $pincode, $instructions, $is_default]);
        $newAddrId = $db->lastInsertId();

        if ($is_default) {
            $parts = array_filter([$house_no, $street, $city, $district, $state, "PIN: $pincode"]);
            $fullAddr = implode(', ', $parts);
            $db->prepare("UPDATE users SET address = ?, house_no = ?, street = ?, city = ?, district = ?, state = ?, pincode = ? WHERE id = ?")
               ->execute([$fullAddr, $house_no, $street, $city, $district, $state, $pincode, $userId]);
        }

        jsonResponse(['success' => true, 'id' => $newAddrId, 'message' => 'Delivery address saved successfully']);
        break;

    case 'update_address':
        $u = checkCustomerRole();
        $userId = $u['id'];
        $addrId = intval($_POST['id'] ?? 0);
        $label = trim($_POST['label'] ?? 'Home');
        $recipient = trim($_POST['recipient_name'] ?? '');
        $phone = trim($_POST['phone'] ?? '');
        $house_no = trim($_POST['house_no'] ?? '');
        $street = trim($_POST['street'] ?? '');
        $city = trim($_POST['city'] ?? '');
        $district = trim($_POST['district'] ?? '');
        $state = trim($_POST['state'] ?? 'Maharashtra');
        $pincode = trim($_POST['pincode'] ?? '');
        $instructions = trim($_POST['delivery_instructions'] ?? '');
        $is_default = (!empty($_POST['is_default']) && ($_POST['is_default'] == '1' || $_POST['is_default'] === 'true')) ? 1 : 0;

        $chk = $db->prepare("SELECT id, is_default FROM customer_addresses WHERE id = ? AND customer_id = ?");
        $chk->execute([$addrId, $userId]);
        $curr = $chk->fetch();
        if (!$curr) {
            jsonResponse(['error' => 'Address not found or unauthorized'], 404);
        }

        if (!$recipient || !$phone || !$city || !$pincode) {
            jsonResponse(['error' => 'Recipient name, phone, city, and PIN code are required'], 400);
        }
        if (!preg_match('/^[0-9]{6}$/', $pincode)) {
            jsonResponse(['error' => 'PIN code must be a 6-digit number'], 400);
        }

        if ($is_default) {
            $db->prepare("UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?")->execute([$userId]);
        } else if ($curr['is_default']) {
            $is_default = 1; // Preserve default status if user was editing the default address
        }

        $stmt = $db->prepare("UPDATE customer_addresses SET label = ?, recipient_name = ?, phone = ?, house_no = ?, street = ?, city = ?, district = ?, state = ?, pincode = ?, delivery_instructions = ?, is_default = ? WHERE id = ? AND customer_id = ?");
        $stmt->execute([$label, $recipient, $phone, $house_no, $street, $city, $district, $state, $pincode, $instructions, $is_default, $addrId, $userId]);

        if ($is_default) {
            $parts = array_filter([$house_no, $street, $city, $district, $state, "PIN: $pincode"]);
            $fullAddr = implode(', ', $parts);
            $db->prepare("UPDATE users SET address = ?, house_no = ?, street = ?, city = ?, district = ?, state = ?, pincode = ? WHERE id = ?")
               ->execute([$fullAddr, $house_no, $street, $city, $district, $state, $pincode, $userId]);
        }

        jsonResponse(['success' => true, 'message' => 'Delivery address updated successfully']);
        break;

    case 'delete_address':
        $u = checkCustomerRole();
        $userId = $u['id'];
        $addrId = intval($_POST['id'] ?? 0);

        $chk = $db->prepare("SELECT id, is_default FROM customer_addresses WHERE id = ? AND customer_id = ?");
        $chk->execute([$addrId, $userId]);
        $curr = $chk->fetch();
        if (!$curr) {
            jsonResponse(['error' => 'Address not found or unauthorized'], 404);
        }

        $wasDefault = $curr['is_default'];
        $del = $db->prepare("DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?");
        $del->execute([$addrId, $userId]);

        // If default address deleted, designate the most recent remaining address as default
        if ($wasDefault) {
            $next = $db->prepare("SELECT id, house_no, street, city, district, state, pincode FROM customer_addresses WHERE customer_id = ? ORDER BY id DESC LIMIT 1");
            $next->execute([$userId]);
            $nextAddr = $next->fetch();
            if ($nextAddr) {
                $db->prepare("UPDATE customer_addresses SET is_default = 1 WHERE id = ?")->execute([$nextAddr['id']]);
                $parts = array_filter([$nextAddr['house_no'], $nextAddr['street'], $nextAddr['city'], $nextAddr['district'], $nextAddr['state'], "PIN: {$nextAddr['pincode']}"]);
                $fullAddr = implode(', ', $parts);
                $db->prepare("UPDATE users SET address = ?, house_no = ?, street = ?, city = ?, district = ?, state = ?, pincode = ? WHERE id = ?")
                   ->execute([$fullAddr, $nextAddr['house_no'], $nextAddr['street'], $nextAddr['city'], $nextAddr['district'], $nextAddr['state'], $nextAddr['pincode'], $userId]);
            }
        }

        jsonResponse(['success' => true, 'message' => 'Address deleted successfully']);
        break;

    case 'set_default_address':
        $u = checkCustomerRole();
        $userId = $u['id'];
        $addrId = intval($_POST['id'] ?? 0);

        $chk = $db->prepare("SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?");
        $chk->execute([$addrId, $userId]);
        $addr = $chk->fetch();
        if (!$addr) {
            jsonResponse(['error' => 'Address not found or unauthorized'], 404);
        }

        $db->prepare("UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?")->execute([$userId]);
        $db->prepare("UPDATE customer_addresses SET is_default = 1 WHERE id = ? AND customer_id = ?")->execute([$addrId, $userId]);

        $parts = array_filter([$addr['house_no'], $addr['street'], $addr['city'], $addr['district'], $addr['state'], "PIN: {$addr['pincode']}"]);
        $fullAddr = implode(', ', $parts);
        $db->prepare("UPDATE users SET address = ?, house_no = ?, street = ?, city = ?, district = ?, state = ?, pincode = ? WHERE id = ?")
           ->execute([$fullAddr, $addr['house_no'], $addr['street'], $addr['city'], $addr['district'], $addr['state'], $addr['pincode'], $userId]);

        jsonResponse(['success' => true, 'message' => 'Default delivery address updated successfully']);
        break;

    // --- SHOP SETTINGS ---
    case 'get_shop_settings':
        $stmt = $db->query("SELECT * FROM shop_settings WHERE id = 1");
        $settings = $stmt->fetch();
        jsonResponse(['settings' => $settings]);
        break;

    case 'update_shop_settings':
        checkShopkeeperRole();
        $shop_name = trim($_POST['shop_name'] ?? '');
        $shop_status = trim($_POST['shop_status'] ?? 'OPEN');
        $shop_upi_id = trim($_POST['shop_upi_id'] ?? '');
        $min_order = floatval($_POST['min_order_amount'] ?? 100);
        $free_delivery = floatval($_POST['free_delivery_above'] ?? 300);
        $delivery_charge = floatval($_POST['delivery_charge'] ?? 20);
        $est_time = trim($_POST['estimated_delivery_time'] ?? '20-35 mins');

        $stmt = $db->prepare("UPDATE shop_settings SET shop_name=?, shop_status=?, shop_upi_id=?, min_order_amount=?, free_delivery_above=?, delivery_charge=?, estimated_delivery_time=? WHERE id=1");
        $stmt->execute([$shop_name, $shop_status, $shop_upi_id, $min_order, $free_delivery, $delivery_charge, $est_time]);
        
        jsonResponse(['success' => true, 'message' => 'Shop settings updated successfully']);
        break;

    case 'toggle_shop_status':
        checkShopkeeperRole();
        $status = trim($_POST['status'] ?? 'OPEN');
        $stmt = $db->prepare("UPDATE shop_settings SET shop_status = ? WHERE id = 1");
        $stmt->execute([$status]);
        jsonResponse(['success' => true, 'status' => $status]);
        break;

    // --- CATEGORIES ---
    case 'get_categories':
        $stmt = $db->query("SELECT * FROM categories ORDER BY id ASC");
        jsonResponse(['categories' => $stmt->fetchAll()]);
        break;

    case 'add_category':
        checkShopkeeperRole();
        $name = trim($_POST['name'] ?? '');
        $icon = trim($_POST['icon'] ?? '🥬');
        $slug = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $name));

        if (!$name) jsonResponse(['error' => 'Category name is required'], 400);

        $stmt = $db->prepare("INSERT INTO categories (name, icon, slug) VALUES (?, ?, ?)");
        $stmt->execute([$name, $icon, $slug]);
        jsonResponse(['success' => true, 'id' => $db->lastInsertId()]);
        break;

    case 'delete_category':
        checkShopkeeperRole();
        $id = intval($_POST['id'] ?? 0);
        $stmt = $db->prepare("DELETE FROM categories WHERE id = ?");
        $stmt->execute([$id]);
        jsonResponse(['success' => true]);
        break;

    // --- PRODUCTS (100% VEGETABLE) ---
    case 'get_products':
        $cat = trim($_GET['category'] ?? 'all');
        $search = trim($_GET['search'] ?? '');
        $filter = trim($_GET['filter'] ?? '');

        $sql = "SELECT p.*, c.name as category_name, c.slug as category_slug FROM products p JOIN categories c ON p.category_id = c.id WHERE p.is_active = 1";
        $params = [];

        if ($cat !== 'all' && $cat !== '') {
            $sql .= " AND c.slug = ?";
            $params[] = $cat;
        }

        if ($search !== '') {
            $sql .= " AND (p.name LIKE ? OR p.description LIKE ?)";
            $params[] = "%$search%";
            $params[] = "%$search%";
        }

        if ($filter === 'fresh') $sql .= " AND p.is_fresh_today = 1";
        if ($filter === 'bestseller') $sql .= " AND p.is_best_seller = 1";
        if ($filter === 'organic') $sql .= " AND p.is_organic = 1";
        if ($filter === 'offers') $sql .= " AND p.discount_percent > 0";

        $sql .= " ORDER BY p.id DESC";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        jsonResponse(['products' => $stmt->fetchAll()]);
        break;

    case 'add_product':
        checkShopkeeperRole();
        $name = trim($_POST['name'] ?? '');
        $cat_id = intval($_POST['category_id'] ?? 1);
        $price = floatval($_POST['price'] ?? 0);
        $unit = trim($_POST['unit'] ?? 'kg');
        $stock = floatval($_POST['stock'] ?? 50);
        $desc = trim($_POST['description'] ?? '');
        $units_opt = trim($_POST['available_units'] ?? '250g, 500g, 1kg, 2kg, 5kg');
        $img = trim($_POST['image_url'] ?? 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=500');
        $fresh = isset($_POST['is_fresh_today']) ? 1 : 0;
        $best = isset($_POST['is_best_seller']) ? 1 : 0;
        $organic = isset($_POST['is_organic']) ? 1 : 0;
        $discount = intval($_POST['discount_percent'] ?? 0);

        if (!$name || $price <= 0) jsonResponse(['error' => 'Valid name and price required'], 400);

        $stmt = $db->prepare("INSERT INTO products (category_id, name, description, price, unit, available_stock, available_units, image_url, is_fresh_today, is_best_seller, is_organic, discount_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$cat_id, $name, $desc, $price, $unit, $stock, $units_opt, $img, $fresh, $best, $organic, $discount]);
        jsonResponse(['success' => true, 'id' => $db->lastInsertId()]);
        break;

    case 'update_product':
        checkShopkeeperRole();
        $id = intval($_POST['id'] ?? 0);
        $name = trim($_POST['name'] ?? '');
        $cat_id = intval($_POST['category_id'] ?? 1);
        $price = floatval($_POST['price'] ?? 0);
        $unit = trim($_POST['unit'] ?? 'kg');
        $stock = floatval($_POST['stock'] ?? 50);
        $desc = trim($_POST['description'] ?? '');
        $units_opt = trim($_POST['available_units'] ?? '250g, 500g, 1kg, 2kg, 5kg');
        $img = trim($_POST['image_url'] ?? '');
        $fresh = isset($_POST['is_fresh_today']) ? 1 : 0;
        $best = isset($_POST['is_best_seller']) ? 1 : 0;
        $organic = isset($_POST['is_organic']) ? 1 : 0;
        $discount = intval($_POST['discount_percent'] ?? 0);

        $stmt = $db->prepare("UPDATE products SET category_id=?, name=?, description=?, price=?, unit=?, available_stock=?, available_units=?, image_url=?, is_fresh_today=?, is_best_seller=?, is_organic=?, discount_percent=? WHERE id=?");
        $stmt->execute([$cat_id, $name, $desc, $price, $unit, $stock, $units_opt, $img, $fresh, $best, $organic, $discount, $id]);
        jsonResponse(['success' => true]);
        break;

    case 'delete_product':
        checkShopkeeperRole();
        $id = intval($_POST['id'] ?? 0);
        $stmt = $db->prepare("UPDATE products SET is_active = 0 WHERE id = ?");
        $stmt->execute([$id]);
        jsonResponse(['success' => true]);
        break;

    // --- ORDERS & CHECKOUT ---
    case 'place_order':
        $user = checkCustomerRole();
        $userId = $user['id'];
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?? $_POST;

        $cust_name = trim($data['customer_name'] ?? $user['name']);
        $cust_phone = trim($data['customer_phone'] ?? $user['phone']);
        $address = '';
        $addressId = intval($data['address_id'] ?? 0);
        if ($addressId > 0) {
            $stmtAddr = $db->prepare("SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?");
            $stmtAddr->execute([$addressId, $userId]);
            $savedAddr = $stmtAddr->fetch();
            if ($savedAddr) {
                $parts = [
                    $savedAddr['recipient_name'] . ' (📞 ' . $savedAddr['phone'] . ')',
                    $savedAddr['house_no'],
                    $savedAddr['street'],
                    $savedAddr['city'],
                    $savedAddr['district'],
                    $savedAddr['state'],
                    $savedAddr['pincode'] ? 'PIN: ' . $savedAddr['pincode'] : ''
                ];
                if (!empty($savedAddr['delivery_instructions'])) {
                    $parts[] = 'Instructions: ' . $savedAddr['delivery_instructions'];
                }
                $address = implode(', ', array_filter($parts));
                if (!empty($savedAddr['label'])) {
                    $address = '[' . $savedAddr['label'] . '] ' . $address;
                }
            }
        }
        if (!$address) {
            $address = trim($data['delivery_address'] ?? ($user['address'] ?: 'Customer Address'));
        }
        $payment_method = trim($data['payment_method'] ?? 'COD');
        $upi_trans_id = trim($data['upi_trans_id'] ?? '');
        $items = $data['items'] ?? [];
        $coupon_code = trim($data['coupon_code'] ?? '');

        if (empty($items)) jsonResponse(['error' => 'Cart is empty'], 400);

        // Fetch shop settings
        $shop = $db->query("SELECT * FROM shop_settings WHERE id = 1")->fetch();
        if ($shop['shop_status'] === 'CLOSED') {
            jsonResponse(['error' => '🥬 Our vegetable shop is currently closed.'], 400);
        }

        $userId = $user['id'];

        // Calculate subtotal & validate stock
        $subtotal = 0;
        $orderItemsData = [];

        foreach ($items as $item) {
            $pId = intval($item['product_id']);
            $weightUnit = $item['unit_weight'] ?? '1kg';
            $qty = intval($item['quantity'] ?? 1);

            $stmt = $db->prepare("SELECT * FROM products WHERE id = ? AND is_active = 1");
            $stmt->execute([$pId]);
            $prod = $stmt->fetch();

            if (!$prod) continue;

            if ($prod['available_stock'] <= 0) {
                jsonResponse(['error' => "Vegetable '{$prod['name']}' is Out of Stock!"], 400);
            }

            // Weight multiplier logic
            $weightMultiplier = 1;
            if ($weightUnit === '250g') $weightMultiplier = 0.25;
            else if ($weightUnit === '500g') $weightMultiplier = 0.5;
            else if (strpos($weightUnit, 'kg') !== false) {
                $weightMultiplier = floatval(str_replace('kg', '', $weightUnit));
            }

            $unitPrice = $prod['price'];
            if ($prod['discount_percent'] > 0) {
                $unitPrice = $unitPrice * (1 - ($prod['discount_percent'] / 100));
            }

            $itemTotal = $unitPrice * $weightMultiplier * $qty;
            $subtotal += $itemTotal;

            $orderItemsData[] = [
                'product_id' => $prod['id'],
                'product_name' => $prod['name'],
                'price' => $unitPrice,
                'unit_weight' => $weightUnit,
                'quantity' => $qty,
                'item_total' => $itemTotal,
                'stock_deduct' => ($weightMultiplier * $qty)
            ];
        }

        if ($subtotal < $shop['min_order_amount']) {
            jsonResponse(['error' => "Minimum order amount is ₹" . number_format($shop['min_order_amount'], 2)], 400);
        }

        // Delivery Fee
        $deliveryFee = ($subtotal >= $shop['free_delivery_above']) ? 0 : $shop['delivery_charge'];

        // Discount Coupon
        $discountAmount = 0;
        if ($coupon_code) {
            $stmt = $db->prepare("SELECT * FROM offers WHERE code = ? AND is_active = 1");
            $stmt->execute([$coupon_code]);
            $coupon = $stmt->fetch();
            if ($coupon && $subtotal >= $coupon['min_order']) {
                if ($coupon['discount_type'] === 'percentage') {
                    $discountAmount = ($subtotal * $coupon['discount_value']) / 100;
                } else {
                    $discountAmount = $coupon['discount_value'];
                }
            }
        }

        $totalAmount = max(0, ($subtotal + $deliveryFee - $discountAmount));
        $orderNumber = '#' . rand(1000, 9999);
        $paymentStatus = ($payment_method === 'COD') ? 'Pending' : ($upi_trans_id ? 'Paid' : 'Pending');

        // Insert Order
        $stmt = $db->prepare("INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, subtotal, delivery_fee, discount_amount, total_amount, delivery_address, payment_method, payment_status, upi_trans_id, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Placed')");
        $stmt->execute([$orderNumber, $userId, $cust_name, $cust_phone, $subtotal, $deliveryFee, $discountAmount, $totalAmount, $address, $payment_method, $paymentStatus, $upi_trans_id]);
        $orderId = $db->lastInsertId();

        // Insert Order Items & Deduct Stock
        foreach ($orderItemsData as $oi) {
            $stmt = $db->prepare("INSERT INTO order_items (order_id, product_id, product_name, price, unit_weight, quantity, item_total) VALUES (?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([$orderId, $oi['product_id'], $oi['product_name'], $oi['price'], $oi['unit_weight'], $oi['quantity'], $oi['item_total']]);

            // Deduct stock
            $stmtStock = $db->prepare("UPDATE products SET available_stock = GREATEST(0, available_stock - ?), sold_stock = sold_stock + ? WHERE id = ?");
            $stmtStock->execute([$oi['stock_deduct'], $oi['stock_deduct'], $oi['product_id']]);
        }

        // Notification for Shopkeeper
        $stmtNotif = $db->prepare("INSERT INTO notifications (user_id, for_role, title, message, type, link) VALUES (NULL, 'shopkeeper', ?, ?, 'order', ?)");
        $stmtNotif->execute([
            "🔔 NEW VEGETABLE ORDER {$orderNumber}",
            "Customer {$cust_name} placed an order of ₹" . number_format($totalAmount, 2) . " via {$payment_method}.",
            "#order-{$orderId}"
        ]);

        // Notification for Customer
        $stmtCustNotif = $db->prepare("INSERT INTO notifications (user_id, for_role, title, message, type, link) VALUES (?, 'customer', ?, ?, 'order', ?)");
        $stmtCustNotif->execute([
            $userId,
            "🎉 Order Placed {$orderNumber}",
            "Your fresh vegetable order has been received! Preparing fresh veggies.",
            "#order-{$orderId}"
        ]);

        jsonResponse([
            'success' => true,
            'order_id' => $orderId,
            'order_number' => $orderNumber,
            'total_amount' => $totalAmount,
            'subtotal' => $subtotal,
            'delivery_fee' => $deliveryFee,
            'discount_amount' => $discountAmount
        ]);
        break;

    case 'get_customer_orders':
        $user = checkCustomerRole();
        $userId = $user['id'];

        $stmt = $db->prepare("SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC");
        $stmt->execute([$userId]);
        $orders = $stmt->fetchAll();

        foreach ($orders as &$ord) {
            $stmtItems = $db->prepare("SELECT oi.*, p.image_url FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?");
            $stmtItems->execute([$ord['id']]);
            $ord['items'] = $stmtItems->fetchAll();

            $stmtRev = $db->prepare("SELECT * FROM reviews WHERE order_id = ?");
            $stmtRev->execute([$ord['id']]);
            $ord['review'] = $stmtRev->fetch();
        }

        jsonResponse(['orders' => $orders]);
        break;

    case 'cancel_customer_order':
        $user = checkCustomerRole();
        $orderId = intval($_POST['order_id'] ?? 0);
        $reason = trim($_POST['reason'] ?? 'Cancelled by customer');

        // Atomic transaction with row lock
        $db->beginTransaction();
        $stmt = $db->prepare("SELECT * FROM orders WHERE id = ? FOR UPDATE");
        $stmt->execute([$orderId]);
        $ord = $stmt->fetch();

        if (!$ord || $ord['customer_id'] != $user['id']) {
            $db->rollBack();
            jsonResponse(['error' => 'Order not found or unauthorized'], 404);
        }

        // Strict rule: only Placed orders can be cancelled by customer
        if ($ord['order_status'] !== 'Placed') {
            $db->rollBack();
            jsonResponse(['error' => 'This order has been accepted by the shopkeeper and can no longer be cancelled.'], 400);
        }

        // Restore vegetable stock
        $stmtItems = $db->prepare("SELECT * FROM order_items WHERE order_id = ?");
        $stmtItems->execute([$orderId]);
        $items = $stmtItems->fetchAll();

        foreach ($items as $item) {
            $weightMultiplier = 1;
            $unit = $item['unit_weight'];
            if ($unit === '250g') $weightMultiplier = 0.25;
            else if ($unit === '500g') $weightMultiplier = 0.5;
            else if (strpos($unit, 'kg') !== false) {
                $weightMultiplier = floatval(str_replace('kg', '', $unit));
            }
            $stockReturn = $weightMultiplier * intval($item['quantity']);

            $stmtStock = $db->prepare("UPDATE products SET available_stock = available_stock + ?, sold_stock = GREATEST(0, sold_stock - ?) WHERE id = ?");
            $stmtStock->execute([$stockReturn, $stockReturn, $item['product_id']]);
        }

        $stmtUp = $db->prepare("UPDATE orders SET order_status = 'Cancelled', rejection_reason = ? WHERE id = ? AND order_status = 'Placed'");
        $stmtUp->execute([$reason, $orderId]);
        $db->commit();

        // Notify shopkeeper
        $stmtNotif = $db->prepare("INSERT INTO notifications (user_id, for_role, title, message, type, link) VALUES (NULL, 'shopkeeper', ?, ?, 'order', ?)");
        $stmtNotif->execute([
            "⚠️ ORDER CANCELLED {$ord['order_number']}",
            "Customer {$user['name']} cancelled order {$ord['order_number']}.",
            "#order-{$orderId}"
        ]);

        jsonResponse(['success' => true, 'message' => 'Your order has been cancelled successfully.']);
        break;

    case 'get_order_details':
        checkAuthUser();
        $orderId = intval($_GET['id'] ?? 0);
        $stmt = $db->prepare("SELECT * FROM orders WHERE id = ?");
        $stmt->execute([$orderId]);
        $ord = $stmt->fetch();

        if ($ord) {
            // Customer can only view their own order
            if ($user['role'] === 'customer' && $ord['customer_id'] != $user['id']) {
                jsonResponse(['error' => 'Unauthorized order access'], 403);
            }
            $stmtItems = $db->prepare("SELECT * FROM order_items WHERE order_id = ?");
            $stmtItems->execute([$ord['id']]);
            $ord['items'] = $stmtItems->fetchAll();

            $stmtRev = $db->prepare("SELECT * FROM reviews WHERE order_id = ?");
            $stmtRev->execute([$ord['id']]);
            $ord['review'] = $stmtRev->fetch();
        }

        jsonResponse(['order' => $ord]);
        break;

    case 'update_order_status':
        checkShopkeeperRole();
        $orderId = intval($_POST['order_id'] ?? 0);
        $newStatus = trim($_POST['status'] ?? '');
        $reason = trim($_POST['reason'] ?? '');

        if (!in_array($newStatus, ['Placed', 'Accepted', 'Preparing', 'OutForDelivery', 'Delivered', 'Rejected', 'Cancelled'])) {
            jsonResponse(['error' => 'Invalid order status'], 400);
        }

        // Atomic transaction with row lock
        $db->beginTransaction();
        $stmt = $db->prepare("SELECT order_status, customer_id, order_number FROM orders WHERE id = ? FOR UPDATE");
        $stmt->execute([$orderId]);
        $ord = $stmt->fetch();

        if (!$ord) {
            $db->rollBack();
            jsonResponse(['error' => 'Order not found'], 404);
        }

        // Prevent accepting orders that have already been cancelled
        if ($ord['order_status'] === 'Cancelled') {
            $db->rollBack();
            jsonResponse(['error' => 'This order was cancelled by the customer and cannot be accepted or updated.'], 400);
        }

        // Allow accepting orders that are Placed (new) or Rejected (re-accept)
        if ($newStatus === 'Accepted' && !in_array($ord['order_status'], ['Placed', 'Rejected'])) {
            $db->rollBack();
            jsonResponse(['error' => 'Cannot accept order: order is already ' . $ord['order_status']], 400);
        }

        $stmtUp = $db->prepare("UPDATE orders SET order_status = ?, rejection_reason = ? WHERE id = ?");
        $stmtUp->execute([$newStatus, $reason, $orderId]);
        $db->commit();

        // Get order info to notify customer
        $statusTitles = [
            'Accepted' => ($ord['order_status'] === 'Rejected') ? '✅ Order Re-Accepted' : '✅ Order Accepted',
            'Preparing' => '🥬 Vegetables Being Prepared',
            'OutForDelivery' => '🛵 Out for Delivery',
            'Delivered' => '🎉 Order Delivered',
            'Rejected' => '❌ Order Rejected'
        ];
        $statusMsgs = [
            'Accepted' => ($ord['order_status'] === 'Rejected')
                ? "Shopkeeper re-accepted your order {$ord['order_number']}. Fresh vegetables are now being prepared!"
                : "Shopkeeper accepted order {$ord['order_number']}.",
            'Preparing' => "Your fresh vegetables for {$ord['order_number']} are being picked & prepared.",
            'OutForDelivery' => "Delivery partner is on the way with your veggies!",
            'Delivered' => "Order {$ord['order_number']} has been delivered. Enjoy fresh vegetables!",
            'Rejected' => "Order {$ord['order_number']} was rejected: {$reason}"
        ];

        if (isset($statusTitles[$newStatus])) {
            $stmtNotif = $db->prepare("INSERT INTO notifications (user_id, for_role, title, message, type) VALUES (?, 'customer', ?, ?, 'order')");
            $stmtNotif->execute([$ord['customer_id'], $statusTitles[$newStatus], $statusMsgs[$newStatus]]);
        }

        jsonResponse(['success' => true]);
        break;

    case 'reaccept_order':
        checkShopkeeperRole();
        $orderId = intval($_POST['order_id'] ?? 0);

        if ($orderId <= 0) {
            jsonResponse(['error' => 'Invalid order ID specified.'], 400);
        }

        // Atomic transaction with row lock
        $db->beginTransaction();
        $stmt = $db->prepare("SELECT order_status, customer_id, order_number FROM orders WHERE id = ? FOR UPDATE");
        $stmt->execute([$orderId]);
        $ord = $stmt->fetch();

        if (!$ord) {
            $db->rollBack();
            jsonResponse(['error' => 'Order not found.'], 404);
        }

        if ($ord['order_status'] === 'Cancelled') {
            $db->rollBack();
            jsonResponse(['error' => 'This order was cancelled by the customer and cannot be re-accepted.'], 400);
        }

        if ($ord['order_status'] !== 'Rejected') {
            $db->rollBack();
            jsonResponse(['error' => 'Only rejected orders can be re-accepted. Current status is: ' . $ord['order_status']], 400);
        }

        // Move status back to Accepted according to workflow; preserve original rejection_reason
        $stmtUp = $db->prepare("UPDATE orders SET order_status = 'Accepted' WHERE id = ?");
        $stmtUp->execute([$orderId]);
        $db->commit();

        // Notify customer
        $stmtNotif = $db->prepare("INSERT INTO notifications (user_id, for_role, title, message, type) VALUES (?, 'customer', ?, ?, 'order')");
        $stmtNotif->execute([
            $ord['customer_id'],
            '✅ Order Re-Accepted',
            "Shopkeeper re-accepted your order {$ord['order_number']}. Preparing your fresh vegetables now!"
        ]);

        jsonResponse(['success' => true, 'message' => "Order {$ord['order_number']} re-accepted successfully."]);
        break;

    // --- SHOPKEEPER DASHBOARD & ORDERS ---
    case 'get_shop_orders':
        checkShopkeeperRole();
        $filter = trim($_GET['filter'] ?? 'all');
        $sql = "SELECT * FROM orders";
        if ($filter === 'pending') $sql .= " WHERE order_status = 'Placed'";
        else if ($filter === 'active') $sql .= " WHERE order_status IN ('Accepted', 'Preparing', 'OutForDelivery')";
        else if ($filter === 'preparing') $sql .= " WHERE order_status IN ('Accepted', 'Preparing')";
        else if ($filter === 'out_for_delivery') $sql .= " WHERE order_status = 'OutForDelivery'";
        else if ($filter === 'completed') $sql .= " WHERE order_status = 'Delivered'";
        else if ($filter === 'rejected') $sql .= " WHERE order_status = 'Rejected'";
        $sql .= " ORDER BY id DESC";

        $stmt = $db->query($sql);
        $orders = $stmt->fetchAll();

        foreach ($orders as &$ord) {
            $stmtItems = $db->prepare("SELECT * FROM order_items WHERE order_id = ?");
            $stmtItems->execute([$ord['id']]);
            $ord['items'] = $stmtItems->fetchAll();
        }

        jsonResponse(['orders' => $orders]);
        break;

    case 'get_shop_dashboard':
        checkShopkeeperRole();
        $today = date('Y-m-d');
        
        $todayOrders = $db->query("SELECT COUNT(*) FROM orders WHERE DATE(created_at) = '$today'")->fetchColumn();
        $pendingOrders = $db->query("SELECT COUNT(*) FROM orders WHERE order_status = 'Placed'")->fetchColumn();
        $preparingOrders = $db->query("SELECT COUNT(*) FROM orders WHERE order_status IN ('Accepted', 'Preparing')")->fetchColumn();
        $outDelivery = $db->query("SELECT COUNT(*) FROM orders WHERE order_status = 'OutForDelivery'")->fetchColumn();
        $completedOrders = $db->query("SELECT COUNT(*) FROM orders WHERE order_status = 'Delivered'")->fetchColumn();
        
        // Accurate Sales for today: only paid orders on current day, excluding rejected and cancelled orders
        $todaySales = $db->query("SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE DATE(created_at) = '$today' AND payment_status = 'Paid' AND order_status NOT IN ('Rejected', 'Cancelled')")->fetchColumn() ?: 0;
        
        // Accurate Pending Payments: orders with payment_status = 'Pending' that are not rejected or cancelled
        $pendingPayments = $db->query("SELECT COUNT(*) FROM orders WHERE payment_status = 'Pending' AND order_status NOT IN ('Rejected', 'Cancelled')")->fetchColumn() ?: 0;
        $pendingPaymentsAmount = $db->query("SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE payment_status = 'Pending' AND order_status NOT IN ('Rejected', 'Cancelled')")->fetchColumn() ?: 0;

        // Active and Rejected order counts for Order Management categories
        $activeOrders = $db->query("SELECT COUNT(*) FROM orders WHERE order_status IN ('Accepted', 'Preparing', 'OutForDelivery')")->fetchColumn() ?: 0;
        $rejectedOrders = $db->query("SELECT COUNT(*) FROM orders WHERE order_status = 'Rejected'")->fetchColumn() ?: 0;

        jsonResponse([
            'today_orders' => intval($todayOrders),
            'pending_orders' => intval($pendingOrders),
            'preparing_orders' => intval($preparingOrders),
            'out_for_delivery' => intval($outDelivery),
            'completed_orders' => intval($completedOrders),
            'today_sales' => floatval($todaySales),
            'pending_payments' => intval($pendingPayments),
            'pending_payments_amount' => floatval($pendingPaymentsAmount),
            'active_orders' => intval($activeOrders),
            'rejected_orders' => intval($rejectedOrders)
        ]);
        break;

    // --- INVENTORY MANAGEMENT ---
    case 'get_inventory':
        checkShopkeeperRole();
        $stmt = $db->query("SELECT p.id, p.name, p.price, p.available_stock, p.sold_stock, p.unit, p.image_url, c.name as category_name FROM products p JOIN categories c ON p.category_id = c.id WHERE p.is_active = 1 ORDER BY p.available_stock ASC");
        jsonResponse(['inventory' => $stmt->fetchAll()]);
        break;

    // --- SALES REPORTS ---
    case 'get_sales_reports':
        checkShopkeeperRole();
        $todaySales = $db->query("SELECT SUM(total_amount) FROM orders WHERE DATE(created_at) = CURDATE() AND order_status != 'Rejected'")->fetchColumn() ?: 0;
        $weeklySales = $db->query("SELECT SUM(total_amount) FROM orders WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND order_status != 'Rejected'")->fetchColumn() ?: 0;
        $monthlySales = $db->query("SELECT SUM(total_amount) FROM orders WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) AND order_status != 'Rejected'")->fetchColumn() ?: 0;
        $totalOrders = $db->query("SELECT COUNT(*) FROM orders WHERE order_status != 'Rejected'")->fetchColumn();
        $avgOrderValue = ($totalOrders > 0) ? ($monthlySales / $totalOrders) : 0;

        // Top Sold Vegetables Leaderboard
        $stmtLeaderboard = $db->query("SELECT product_name, SUM(quantity) as total_qty, SUM(item_total) as total_rev FROM order_items GROUP BY product_name ORDER BY total_qty DESC LIMIT 5");
        $leaderboard = $stmtLeaderboard->fetchAll();

        jsonResponse([
            'today_sales' => floatval($todaySales),
            'weekly_sales' => floatval($weeklySales),
            'monthly_sales' => floatval($monthlySales),
            'total_orders' => intval($totalOrders),
            'avg_order_value' => floatval($avgOrderValue),
            'top_vegetables' => $leaderboard
        ]);
        break;

    // --- PAYMENTS (CUSTOMER & SHOPKEEPER) ---
    case 'get_customer_payments':
        $user = checkCustomerRole();
        $userId = $user['id'];

        $search = trim($_GET['search'] ?? '');
        $status = trim($_GET['status'] ?? 'all');
        $method = trim($_GET['method'] ?? 'all');
        $dateFilter = trim($_GET['date_filter'] ?? 'all');
        $sort = trim($_GET['sort'] ?? 'newest');

        $where = ["customer_id = ?"];
        $params = [$userId];

        if ($status !== 'all' && in_array($status, ['Paid', 'Pending', 'Failed', 'Refunded'])) {
            $where[] = "payment_status = ?";
            $params[] = $status;
        }

        if ($method !== 'all' && !empty($method)) {
            $where[] = "payment_method = ?";
            $params[] = $method;
        }

        if ($search !== '') {
            $where[] = "(order_number LIKE ? OR upi_trans_id LIKE ?)";
            $params[] = "%$search%";
            $params[] = "%$search%";
        }

        if ($dateFilter === 'today') {
            $where[] = "DATE(created_at) = CURDATE()";
        } else if ($dateFilter === 'week') {
            $where[] = "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
        } else if ($dateFilter === 'month') {
            $where[] = "created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
        }

        $orderBy = match ($sort) {
            'oldest' => 'id ASC',
            'amount_high' => 'total_amount DESC',
            'amount_low' => 'total_amount ASC',
            default => 'id DESC'
        };

        $sql = "SELECT * FROM orders WHERE " . implode(' AND ', $where) . " ORDER BY " . $orderBy;
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $orders = $stmt->fetchAll();

        foreach ($orders as &$ord) {
            $stmtItems = $db->prepare("SELECT oi.*, p.image_url FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?");
            $stmtItems->execute([$ord['id']]);
            $items = $stmtItems->fetchAll();
            $ord['items'] = $items;
            
            $itemDesc = [];
            foreach ($items as $it) {
                $itemDesc[] = "{$it['product_name']} ({$it['unit_weight']} × {$it['quantity']})";
            }
            $ord['items_summary'] = implode(', ', $itemDesc);
            $ord['transaction_ref'] = !empty($ord['upi_trans_id']) ? $ord['upi_trans_id'] : ('TXN-ORD-' . $ord['id']);
            $ord['amount_paid'] = ($ord['payment_status'] === 'Paid') ? floatval($ord['total_amount']) : 0.00;
        }

        // Summary for this customer
        $stmtSum = $db->prepare("SELECT 
            COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_amount ELSE 0 END), 0) as total_paid,
            COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END) as count_paid,
            COALESCE(SUM(CASE WHEN payment_status = 'Pending' THEN total_amount ELSE 0 END), 0) as total_pending,
            COUNT(CASE WHEN payment_status = 'Pending' THEN 1 END) as count_pending,
            COUNT(*) as total_transactions
            FROM orders WHERE customer_id = ?");
        $stmtSum->execute([$userId]);
        $summary = $stmtSum->fetch();

        jsonResponse([
            'success' => true,
            'payments' => $orders,
            'summary' => [
                'total_paid' => floatval($summary['total_paid'] ?? 0),
                'count_paid' => intval($summary['count_paid'] ?? 0),
                'total_pending' => floatval($summary['total_pending'] ?? 0),
                'count_pending' => intval($summary['count_pending'] ?? 0),
                'total_transactions' => intval($summary['total_transactions'] ?? 0)
            ]
        ]);
        break;

    case 'get_payments':
        checkShopkeeperRole();

        $search = trim($_GET['search'] ?? '');
        $status = trim($_GET['status'] ?? 'all');
        $method = trim($_GET['method'] ?? 'all');
        $dateFilter = trim($_GET['date_filter'] ?? 'all');
        $sort = trim($_GET['sort'] ?? 'newest');

        $where = ["1=1"];
        $params = [];

        if ($status !== 'all' && in_array($status, ['Paid', 'Pending', 'Failed', 'Refunded'])) {
            $where[] = "payment_status = ?";
            $params[] = $status;
        }

        if ($method !== 'all' && !empty($method)) {
            $where[] = "payment_method = ?";
            $params[] = $method;
        }

        if ($search !== '') {
            $where[] = "(order_number LIKE ? OR upi_trans_id LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)";
            $params[] = "%$search%";
            $params[] = "%$search%";
            $params[] = "%$search%";
            $params[] = "%$search%";
        }

        if ($dateFilter === 'today') {
            $where[] = "DATE(created_at) = CURDATE()";
        } else if ($dateFilter === 'week') {
            $where[] = "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
        } else if ($dateFilter === 'month') {
            $where[] = "created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
        }

        $orderBy = match ($sort) {
            'oldest' => 'id ASC',
            'amount_high' => 'total_amount DESC',
            'amount_low' => 'total_amount ASC',
            default => 'id DESC'
        };

        $sql = "SELECT * FROM orders WHERE " . implode(' AND ', $where) . " ORDER BY " . $orderBy;
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $orders = $stmt->fetchAll();

        foreach ($orders as &$ord) {
            $stmtItems = $db->prepare("SELECT oi.*, p.image_url FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?");
            $stmtItems->execute([$ord['id']]);
            $items = $stmtItems->fetchAll();
            $ord['items'] = $items;
            
            $itemDesc = [];
            foreach ($items as $it) {
                $itemDesc[] = "{$it['product_name']} ({$it['unit_weight']} × {$it['quantity']})";
            }
            $ord['items_summary'] = implode(', ', $itemDesc);
            $ord['transaction_ref'] = !empty($ord['upi_trans_id']) ? $ord['upi_trans_id'] : ('TXN-ORD-' . $ord['id']);
            $ord['amount_paid'] = ($ord['payment_status'] === 'Paid') ? floatval($ord['total_amount']) : 0.00;
        }

        // Shopkeeper Overall Summary (Accurate from real DB records)
        $summarySql = "SELECT 
            COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_amount ELSE 0 END), 0) as total_paid,
            COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END) as count_paid,
            COALESCE(SUM(CASE WHEN payment_status = 'Pending' THEN total_amount ELSE 0 END), 0) as total_pending,
            COUNT(CASE WHEN payment_status = 'Pending' THEN 1 END) as count_pending,
            COUNT(CASE WHEN payment_status = 'Failed' THEN 1 END) as count_failed,
            COALESCE(SUM(CASE WHEN payment_status = 'Refunded' THEN total_amount ELSE 0 END), 0) as total_refunded,
            COUNT(CASE WHEN payment_status = 'Refunded' THEN 1 END) as count_refunded,
            COUNT(*) as total_orders
            FROM orders";
        $overall = $db->query($summarySql)->fetch();

        // Filtered summary (respecting active filters)
        $filteredSummarySql = "SELECT 
            COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_amount ELSE 0 END), 0) as total_paid,
            COUNT(CASE WHEN payment_status = 'Paid' THEN 1 END) as count_paid,
            COALESCE(SUM(CASE WHEN payment_status = 'Pending' THEN total_amount ELSE 0 END), 0) as total_pending,
            COUNT(CASE WHEN payment_status = 'Pending' THEN 1 END) as count_pending,
            COUNT(CASE WHEN payment_status = 'Failed' THEN 1 END) as count_failed,
            COALESCE(SUM(CASE WHEN payment_status = 'Refunded' THEN total_amount ELSE 0 END), 0) as total_refunded,
            COUNT(*) as total_count
            FROM orders WHERE " . implode(' AND ', $where);
        $stmtFilt = $db->prepare($filteredSummarySql);
        $stmtFilt->execute($params);
        $filtered = $stmtFilt->fetch();

        jsonResponse([
            'success' => true,
            'payments' => $orders,
            'summary' => [
                'total_paid' => floatval($overall['total_paid'] ?? 0),
                'count_paid' => intval($overall['count_paid'] ?? 0),
                'total_pending' => floatval($overall['total_pending'] ?? 0),
                'count_pending' => intval($overall['count_pending'] ?? 0),
                'count_failed' => intval($overall['count_failed'] ?? 0),
                'total_refunded' => floatval($overall['total_refunded'] ?? 0),
                'count_refunded' => intval($overall['count_refunded'] ?? 0),
                'total_orders' => intval($overall['total_orders'] ?? 0)
            ],
            'filtered_summary' => [
                'total_paid' => floatval($filtered['total_paid'] ?? 0),
                'count_paid' => intval($filtered['count_paid'] ?? 0),
                'total_pending' => floatval($filtered['total_pending'] ?? 0),
                'count_pending' => intval($filtered['count_pending'] ?? 0),
                'count_failed' => intval($filtered['count_failed'] ?? 0),
                'total_refunded' => floatval($filtered['total_refunded'] ?? 0),
                'total_count' => intval($filtered['total_count'] ?? 0)
            ]
        ]);
        break;

    case 'verify_payment':
        checkShopkeeperRole();
        $orderId = intval($_POST['order_id'] ?? 0);
        $status = trim($_POST['payment_status'] ?? 'Paid');

        if (!in_array($status, ['Paid', 'Pending', 'Failed', 'Refunded'])) {
            jsonResponse(['error' => 'Invalid payment status'], 400);
        }

        $stmt = $db->prepare("SELECT * FROM orders WHERE id = ?");
        $stmt->execute([$orderId]);
        $ord = $stmt->fetch();
        if (!$ord) {
            jsonResponse(['error' => 'Order not found'], 404);
        }

        $stmtUp = $db->prepare("UPDATE orders SET payment_status = ? WHERE id = ?");
        $stmtUp->execute([$status, $orderId]);

        // Notify customer
        if ($status === 'Paid') {
            $stmtNotif = $db->prepare("INSERT INTO notifications (user_id, for_role, title, message, type, link) VALUES (?, 'customer', ?, ?, 'payment', ?)");
            $stmtNotif->execute([
                $ord['customer_id'],
                "💳 Payment Confirmed {$ord['order_number']}",
                "Payment of ₹" . number_format($ord['total_amount'], 2) . " for order {$ord['order_number']} has been verified and marked as Paid.",
                "#payments"
            ]);
        }

        jsonResponse(['success' => true, 'message' => "Payment marked as {$status} successfully"]);
        break;

    case 'get_payment_receipt':
        $u = checkAuthUser();
        $orderId = intval($_GET['order_id'] ?? 0);

        $stmt = $db->prepare("SELECT * FROM orders WHERE id = ?");
        $stmt->execute([$orderId]);
        $ord = $stmt->fetch();

        if (!$ord) {
            jsonResponse(['error' => 'Receipt not found'], 404);
        }

        // Authorization check: customer can only view their own receipt
        if ($u['role'] === 'customer' && $ord['customer_id'] != $u['id']) {
            jsonResponse(['error' => 'Unauthorized receipt access'], 403);
        }

        $stmtItems = $db->prepare("SELECT oi.*, p.image_url FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?");
        $stmtItems->execute([$ord['id']]);
        $ord['items'] = $stmtItems->fetchAll();

        $shop = $db->query("SELECT shop_name, shop_upi_id, estimated_delivery_time FROM shop_settings WHERE id = 1")->fetch();

        jsonResponse([
            'success' => true,
            'receipt' => [
                'order' => $ord,
                'items' => $ord['items'],
                'shop' => $shop,
                'transaction_ref' => !empty($ord['upi_trans_id']) ? $ord['upi_trans_id'] : ('TXN-ORD-' . $ord['id']),
                'receipt_no' => 'REC-' . str_replace('#', '', $ord['order_number']) . '-' . $ord['id'],
                'amount_paid' => ($ord['payment_status'] === 'Paid') ? floatval($ord['total_amount']) : 0.00
            ]
        ]);
        break;

    // --- REVIEWS & REORDER ---
    case 'submit_review':
        $orderId = intval($_POST['order_id'] ?? 0);
        $rating = intval($_POST['rating'] ?? 5);
        $freshness = intval($_POST['freshness_rating'] ?? 5);
        $delivery = intval($_POST['delivery_rating'] ?? 5);
        $comment = trim($_POST['comment'] ?? '');

        $userId = $user['id'] ?? 1;
        $custName = $user['name'] ?? 'Rahul Sharma';

        $stmt = $db->prepare("INSERT INTO reviews (order_id, customer_id, customer_name, rating, freshness_rating, delivery_rating, comment) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$orderId, $userId, $custName, $rating, $freshness, $delivery, $comment]);
        jsonResponse(['success' => true]);
        break;

    case 'get_offers':
        $stmt = $db->query("SELECT * FROM offers WHERE is_active = 1");
        jsonResponse(['offers' => $stmt->fetchAll()]);
        break;

    // --- MESSAGING ---
    case 'get_messages':
        $stmt = $db->query("SELECT m.*, u.name as customer_name FROM support_messages m JOIN users u ON m.customer_id = u.id ORDER BY m.id ASC");
        jsonResponse(['messages' => $stmt->fetchAll()]);
        break;

    case 'send_message':
        $msg = trim($_POST['message'] ?? '');
        $sender = trim($_POST['sender_type'] ?? 'customer');
        $custId = intval($_POST['customer_id'] ?? ($user['id'] ?? 1));

        if (!$msg) jsonResponse(['error' => 'Message content empty'], 400);

        $stmt = $db->prepare("INSERT INTO support_messages (customer_id, sender_type, message) VALUES (?, ?, ?)");
        $stmt->execute([$custId, $sender, $msg]);
        jsonResponse(['success' => true]);
        break;

    // --- REALTIME POLLING / NOTIFICATIONS ---
    case 'get_notifications':
        $role = $user['role'] ?? ($_GET['role'] ?? 'customer');
        $userId = $user['id'] ?? null;

        $sql = "SELECT * FROM notifications WHERE (for_role = 'all' OR for_role = ?)";
        $params = [$role];
        if ($role === 'customer' && $userId) {
            $sql .= " AND (user_id = ? OR user_id IS NULL)";
            $params[] = $userId;
        }
        $sql .= " ORDER BY id DESC LIMIT 15";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        jsonResponse(['notifications' => $stmt->fetchAll()]);
        break;

    case 'stream_updates':
        $role = $_GET['role'] ?? 'customer';
        $pendingCount = $db->query("SELECT COUNT(*) FROM orders WHERE order_status = 'Placed'")->fetchColumn();
        $shop = $db->query("SELECT shop_status FROM shop_settings WHERE id = 1")->fetch();

        jsonResponse([
            'pending_orders_count' => intval($pendingCount),
            'shop_status' => $shop['shop_status'] ?? 'OPEN'
        ]);
        break;

    default:
        jsonResponse(['error' => 'Invalid action parameter'], 400);
        break;
}
