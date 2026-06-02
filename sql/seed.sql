INSERT INTO roles (name)
SELECT 'Super Admin'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Super Admin');

INSERT INTO role_permissions (role_id, module)
SELECT r.id, m.module
FROM roles r
CROSS JOIN (
  VALUES ('dashboard'), ('questions'), ('responses'), ('doctor-ratings'),
         ('doctors'), ('patients'), ('encounters'), ('reports'),
         ('users'), ('activity'), ('roles'), ('import'),
         ('upload'), ('email-settings')
) AS m(module)
WHERE r.name = 'Super Admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.module = m.module
  );

-- Create default admin user (only if no admin exists yet)
INSERT INTO admin_users (username, email, password_hash, role_id)
SELECT 'admin', 'admin@hospital.com',
  '$2b$12$1ipL4mMr1YxmBJFhwDryg.RHYs6kDCFAhw9rhFED/pfar1eSF9jz.',
  (SELECT id FROM roles WHERE name = 'Super Admin')
WHERE NOT EXISTS (SELECT 1 FROM admin_users);

-- Assign Super Admin role to any existing admin that has no role
UPDATE admin_users SET role_id = (SELECT id FROM roles WHERE name = 'Super Admin')
WHERE role_id IS NULL;
