from __future__ import annotations

from app.database.session import SessionLocal, engine
from app.models import entities  # noqa: F401
from app.models.base import Base
from app.schemas.common import IngredientIn, InstructionIn, RecipeCreate
from app.services.recipes import create_recipe

PLACEHOLDER = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c"

MEALS = [
    (
        "Chicken quesadillas",
        "20 minute skillet quesadillas",
        ["1 lb chicken breast", "2 cups shredded cheese", "8 tortillas", "1 cup salsa"],
        ["Cook chicken.", "Fill tortillas with chicken and cheese.", "Toast until crisp."],
        ["chicken", "quick"],
    ),
    (
        "Taco bowls",
        "Rice bowls with taco toppings",
        ["1 lb ground beef", "2 cups rice", "1 can black beans", "1 cup corn"],
        ["Brown beef.", "Cook rice.", "Assemble bowls with toppings."],
        ["beef", "meal prep"],
    ),
    (
        "Sheet-pan sausage and vegetables",
        "Easy oven dinner",
        ["1 lb smoked sausage", "2 bell peppers", "1 red onion", "2 tbsp olive oil"],
        ["Slice sausage and vegetables.", "Roast on a sheet pan.", "Serve warm."],
        ["sheet pan"],
    ),
    (
        "Garlic chicken pasta",
        "Creamy family pasta",
        ["1 lb chicken breast", "12 oz pasta", "3 cloves garlic", "1 cup cream"],
        ["Cook pasta.", "Saute chicken and garlic.", "Toss with cream sauce."],
        ["pasta"],
    ),
    (
        "Honey garlic chicken and rice",
        "Sweet savory chicken dinner",
        ["1 lb chicken thighs", "2 cups rice", "3 tbsp honey", "2 cloves garlic"],
        ["Cook rice.", "Sear chicken.", "Simmer with honey garlic sauce."],
        ["chicken"],
    ),
    (
        "Burgers",
        "Simple stovetop burgers",
        ["1 lb ground beef", "4 burger buns", "4 slices cheese", "1 tomato"],
        ["Form patties.", "Cook patties.", "Assemble burgers."],
        ["beef"],
    ),
    (
        "Vegetable stir-fry",
        "Fast veggie dinner",
        ["2 cups broccoli", "1 bell pepper", "1 cup carrots", "2 tbsp soy sauce"],
        ["Chop vegetables.", "Stir-fry over high heat.", "Serve with rice."],
        ["vegetarian"],
    ),
    (
        "Baked ziti",
        "Comforting pasta bake",
        ["1 lb ziti", "2 cups marinara", "1 cup ricotta", "2 cups mozzarella"],
        ["Boil ziti.", "Mix with sauce and cheese.", "Bake until bubbly."],
        ["pasta"],
    ),
    (
        "Slow-cooker chicken tacos",
        "Hands-off taco filling",
        ["2 lb chicken breast", "1 jar salsa", "1 packet taco seasoning", "12 tortillas"],
        ["Add chicken to slow cooker.", "Cook with salsa and seasoning.", "Shred and serve."],
        ["slow cooker"],
    ),
    (
        "Breakfast-for-dinner",
        "Eggs, potatoes, and toast",
        ["8 eggs", "1 lb potatoes", "4 slices bread", "1 tbsp butter"],
        ["Roast potatoes.", "Scramble eggs.", "Toast bread."],
        ["breakfast"],
    ),
    (
        "Personal pizzas",
        "Custom mini pizzas",
        ["4 pita breads", "1 cup pizza sauce", "2 cups mozzarella", "1 cup pepperoni"],
        ["Top pita breads.", "Bake until cheese melts.", "Slice and serve."],
        ["kid friendly"],
    ),
    (
        "Grilled chicken wraps",
        "Fresh wrap dinner",
        ["1 lb grilled chicken", "4 tortillas", "2 cups lettuce", "1 cup ranch"],
        ["Slice chicken.", "Fill tortillas.", "Roll wraps tightly."],
        ["chicken"],
    ),
]


def main() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        for name, description, ingredients, instructions, tags in MEALS:
            if db.query(entities.Recipe).filter_by(name=name, owner_user_id=None).first():
                continue
            payload = RecipeCreate(
                name=name,
                description=f"Development seed: {description}",
                photo_url=PLACEHOLDER,
                servings=4,
                prep_minutes=10,
                cook_minutes=20,
                total_minutes=30,
                difficulty="easy",
                tags=tags,
                meal_type="dinner",
                source_type="manual",
                ingredients=[IngredientIn(original_text=item) for item in ingredients],
                instructions=[
                    InstructionIn(step_number=index, text=step)
                    for index, step in enumerate(instructions, start=1)
                ],
            )
            create_recipe(db, payload, None)
    print("Seeded Dinner Swipe development recipes")


if __name__ == "__main__":
    main()
