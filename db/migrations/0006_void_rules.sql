-- A voided booking always says who voided it, when and why. (Separate from 0005: it uses the new enum value.)
alter table appointments add constraint appointments_void_has_reason
  check (status <> 'voided' or (void_reason is not null and char_length(void_reason) > 0 and voided_at is not null));
